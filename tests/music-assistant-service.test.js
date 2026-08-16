const test = require('node:test')
const assert = require('node:assert/strict')

const { createMusicAssistantService } = require('../cloudfunctions/musicAssistant/service')

function memoryStore() {
  const jobs = new Map()
  const profileCache = new Map()
  const currentProfiles = new Map()
  return {
    async saveJob(owner, job) { jobs.set(`${owner}:${job.id}`, JSON.parse(JSON.stringify(job))); return job },
    async getJob(owner, id) { return jobs.get(`${owner}:${id}`) || null },
    async getLatestJob(owner) { return [...jobs.entries()].filter(([key]) => key.startsWith(`${owner}:`)).map(([, value]) => value).at(-1) || null },
    async claimSong(owner, jobId, songId, lease) {
      const key = `${owner}:${jobId}`
      const job = jobs.get(key)
      if (!job) return { claimed: false, job: null }
      if (job.lease && job.lease.expiresAt > lease.now) return { claimed: false, job: JSON.parse(JSON.stringify(job)) }
      const claimed = { ...job, status: 'running', currentSongId: songId, lease: { songId, token: lease.token, expiresAt: lease.expiresAt }, updatedAt: lease.now }
      jobs.set(key, JSON.parse(JSON.stringify(claimed)))
      return { claimed: true, job: claimed }
    },
    async finishSongClaim(owner, job, token) {
      const key = `${owner}:${job.id}`
      const current = jobs.get(key)
      if (!current || !current.lease || current.lease.token !== token) return current || null
      const finished = JSON.parse(JSON.stringify(job)); delete finished.lease
      jobs.set(key, finished)
      return finished
    },
    async releaseSongClaim(owner, jobId, token) {
      const key = `${owner}:${jobId}`
      const current = jobs.get(key)
      if (current && current.lease && current.lease.token === token) {
        delete current.lease
        current.currentSongId = ''
        jobs.set(key, current)
      }
    },
    async findProfile(owner, cacheKey) { return profileCache.get(`${owner}:${cacheKey}`) || null },
    async saveProfile(owner, profile) {
      const saved = JSON.parse(JSON.stringify(profile))
      profileCache.set(`${owner}:${profile.cacheKey}`, saved)
      currentProfiles.set(`${owner}:${profile.songId}`, saved)
      return profile
    },
    async listProfiles(owner) { return [...currentProfiles.entries()].filter(([key]) => key.startsWith(`${owner}:`)).map(([, value]) => value) },
    async countProfiles(owner) { return (await this.listProfiles(owner)).length },
    async listRunnableJobs() {
      return [...jobs.values()].filter((job) => ['queued', 'running'].includes(job.status))
    },
    async claimNcmOwner() { return true },
    inspect() { return { jobs: [...jobs.values()], profiles: [...currentProfiles.values()], cache: [...profileCache.values()] } }
  }
}

function memoryCredentials() {
  const values = new Map()
  let sequence = 0
  return {
    seal(value, context) {
      const token = `sealed-${++sequence}`
      values.set(`${token}:${context}`, value)
      return { token }
    },
    open(payload, context) { return values.get(`${payload.token}:${context}`) || '' }
  }
}

test('background worker resumes after the page exits and removes its temporary credential on completion', async () => {
  const store = memoryStore()
  const ncm = {
    async listLikedSongs() { return [{ id: '1', title: '夜航' }, { id: '2', title: '晴天' }] },
    async getSongSource(id, song) { return { ...song, id, lyrics: `歌词${id}` } }
  }
  const ai = { async completeJson() { return { summary: '画像', naming: { fit_score: 8 } } } }
  const service = createMusicAssistantService({
    store,
    ncm,
    ai,
    credentials: memoryCredentials(),
    id: () => 'background-job',
    now: () => '2026-08-15T12:00:00.000Z'
  })

  const started = await service.startJob('openid-a', { limit: 2, model: 'deepseek-v4-flash', apiKey: 'temporary-secret' })
  const queued = await store.getJob('openid-a', started.id)
  assert.equal(JSON.stringify(queued).includes('temporary-secret'), false)
  assert.ok(queued.apiCredential)

  const result = await service.runBackground({ maxSongs: 10 })
  assert.equal(result.completed, 2)
  const finished = await store.getJob('openid-a', started.id)
  assert.equal(finished.status, 'completed')
  assert.equal(Object.hasOwn(finished, 'apiCredential'), false)
  assert.equal(Object.hasOwn(finished, 'credentialExpiresAt'), false)
  assert.equal((await store.listProfiles('openid-a')).length, 2)
})

test('a background model failure pauses safely, deletes the credential and can resume with a new one', async () => {
  const store = memoryStore()
  const ncm = {
    async listLikedSongs() { return [{ id: '1', title: '夜航' }] },
    async getSongSource(id, song) { return { ...song, id, lyrics: '凌晨' } }
  }
  let fail = true
  const ai = { async completeJson() { if (fail) throw new Error('DeepSeek 暂时不可用'); return { summary: '画像', naming: { fit_score: 8 } } } }
  const service = createMusicAssistantService({ store, ncm, ai, credentials: memoryCredentials(), id: () => 'paused-background-job' })
  const started = await service.startJob('openid-a', { limit: 1, model: 'deepseek-v4-flash', apiKey: 'first-secret' })

  await service.runBackground({ maxSongs: 1 })
  const paused = await store.getJob('openid-a', started.id)
  assert.equal(paused.status, 'paused')
  assert.equal(Object.hasOwn(paused, 'apiCredential'), false)

  fail = false
  await service.resumeJob('openid-a', { jobId: started.id, apiKey: 'second-secret' })
  await service.runBackground({ maxSongs: 1 })
  assert.equal((await store.getJob('openid-a', started.id)).status, 'completed')
})

test('job processes one song per call, resumes, caches output and never stores the API key', async () => {
  const store = memoryStore()
  const ncm = {
    async listLikedSongs() { return [{ id: '1', title: '夜航', artist: '甲', album: '城市' }, { id: '2', title: '晴天', artist: '乙', album: '夏天' }] },
    async getSongSource(id, song) { return { ...song, id, lyrics: id === '1' ? '凌晨的街道' : '阳光下奔跑' } }
  }
  let calls = 0
  const ai = { async completeJson() { calls += 1; return { summary: '城市夜色', emotion_keywords: ['克制'], scene_sensory_keywords: ['夜路'], naming: { preferred_title: '夜航', fit_score: 88 }, analysis_confidence: 90 } } }
  const service = createMusicAssistantService({ store, ncm, ai, id: () => 'job-1', now: () => '2026-08-03T00:00:00.000Z' })

  const started = await service.startJob('openid-a', { limit: 2, model: 'deepseek-v4-flash', apiKey: 'secret' })
  assert.equal(JSON.stringify(store.inspect()).includes('secret'), false)
  assert.equal(started.progress.total, 2)

  const first = await service.processNext('openid-a', { jobId: started.id, model: 'deepseek-v4-flash', apiKey: 'secret' })
  assert.equal(first.progress.completed, 1)
  assert.equal(first.status, 'running')
  assert.equal(store.inspect().profiles[0].fitScore, 10)
  assert.equal(Object.hasOwn(store.inspect().profiles[0], 'analysisConfidence'), false)
  const second = await service.processNext('openid-a', { jobId: started.id, model: 'deepseek-v4-flash', apiKey: 'secret' })
  assert.equal(second.status, 'completed')
  assert.equal(calls, 2)

  const restarted = await service.startJob('openid-a', { limit: 2, model: 'deepseek-v4-flash' })
  await service.processNext('openid-a', { jobId: restarted.id, model: 'deepseek-v4-flash', apiKey: 'secret' })
  assert.equal(calls, 2)
  assert.equal((await service.getStatus('openid-a')).analyzedCount, 2)
})

test('starting an import reports an empty liked-song result instead of completing a zero-song job', async () => {
  const store = memoryStore()
  const ncm = { async listLikedSongs() { return [] } }
  const service = createMusicAssistantService({ store, ncm, ai: {} })

  await assert.rejects(
    service.startJob('openid-a', { limit: 20, model: 'deepseek-v4-flash' }),
    (error) => error.code === 'NO_LIKED_SONGS' && /没有读取到红心歌曲/.test(error.message)
  )
  assert.equal(store.inspect().jobs.length, 0)
})

test('naming returns the model reason without adding a fixed programmatic introduction', async () => {
  const store = memoryStore()
  await store.saveProfile('openid-a', { cacheKey: 'one', songId: '1', title: '夜航', artist: '甲', preferredTitle: '夜航', summary: '在夜路中保持清醒和克制', emotion_keywords: ['清冷'], scene_sensory_keywords: ['夏夜'], fitScore: 90 })
  let call = 0
  const ai = {
    async completeJson() {
      call += 1
      if (call === 1) return { summary: '清爽', emotion_keywords: ['清冷'], scene_sensory_keywords: ['夏夜'], naming_direction: { desired: ['短'], avoid: [] } }
      return { recommendations: [{ song_id: '1', recommended_name: '模型杜撰的新名字', reason: '甲借《夜航》表达了在夜路中保持清醒和克制的态度，清冷的金酒也像夏夜里的一段夜航。' }] }
    }
  }
  const service = createMusicAssistantService({ store, ncm: {}, ai })
  const result = await service.recommendNames('openid-a', {
    apiKey: 'secret', model: 'deepseek-v4-flash', color: '绿色', ingredients: [{ name: '金酒', amount: 45, unit: 'ml' }]
  })
  assert.equal(result.recommendations[0].recommended_name, '夜航')
  assert.equal(result.recommendations[0].artist, '甲')
  assert.equal(result.recommendations[0].reason, '甲借《夜航》表达了在夜路中保持清醒和克制的态度，清冷的金酒也像夏夜里的一段夜航。')
  assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('a DeepSeek outage pauses the job instead of marking every remaining song failed', async () => {
  const store = memoryStore()
  const ncm = {
    async listLikedSongs() { return [{ id: '1', title: '夜航' }] },
    async getSongSource(id, song) { return { ...song, id, lyrics: '凌晨' } }
  }
  const ai = { async completeJson() { throw new Error('DeepSeek 请求失败（401）') } }
  const service = createMusicAssistantService({ store, ncm, ai, id: () => 'paused-job' })
  const job = await service.startJob('openid-a', { limit: 1, model: 'deepseek-v4-flash' })
  await assert.rejects(service.processNext('openid-a', { jobId: job.id, apiKey: 'bad-key' }), /DeepSeek/)
  const stored = await store.getJob('openid-a', job.id)
  assert.deepEqual(stored.progress, { total: 1, completed: 0, failed: 0, skipped: 0 })
})

test('reanalysis keeps one current profile per song while retaining versioned cache entries', async () => {
  const store = memoryStore()
  const ncm = {
    async listLikedSongs() { return [{ id: '1', title: '夜航' }] },
    async getSongSource(id, song) { return { ...song, id, lyrics: '凌晨' } }
  }
  let aiCalls = 0
  let jobSequence = 0
  const ai = { async completeJson() { aiCalls += 1; return { summary: `画像${aiCalls}`, naming: { fit_score: 80 } } } }
  const service = createMusicAssistantService({ store, ncm, ai, id: () => `job-${++jobSequence}` })

  const flash = await service.startJob('openid-a', { limit: 1, model: 'deepseek-v4-flash' })
  await service.processNext('openid-a', { jobId: flash.id, apiKey: 'key' })
  const pro = await service.startJob('openid-a', { limit: 1, model: 'deepseek-v4-pro' })
  await service.processNext('openid-a', { jobId: pro.id, apiKey: 'key' })
  const flashAgain = await service.startJob('openid-a', { limit: 1, model: 'deepseek-v4-flash' })
  const reused = await service.processNext('openid-a', { jobId: flashAgain.id, apiKey: 'key' })

  assert.equal(aiCalls, 2)
  assert.equal(reused.progress.skipped, 1)
  assert.equal(store.inspect().cache.length, 2)
  assert.equal((await store.listProfiles('openid-a')).length, 1)
  assert.equal((await store.listProfiles('openid-a'))[0].model, 'deepseek-v4-flash')
})

test('single-account prototype locks the NetEase session to the first WeChat user', async () => {
  const store = memoryStore()
  let claimedBy = ''
  store.checkNcmOwner = async (owner) => {
    if (!claimedBy) return false
    if (claimedBy !== owner) throw Object.assign(new Error('网易云账号已由其他用户连接'), { code: 'NCM_OWNER_MISMATCH' })
    return true
  }
  store.claimNcmOwner = async (owner) => {
    if (claimedBy && claimedBy !== owner) throw Object.assign(new Error('网易云账号已由其他用户连接'), { code: 'NCM_OWNER_MISMATCH' })
    claimedBy = owner
  }
  const ncm = { async startLogin() { return { loggedIn: false } }, async loginStatus() { return { loggedIn: false } } }
  const service = createMusicAssistantService({ store, ncm, ai: {} })
  assert.deepEqual(await service.checkNcmLogin('openid-a'), { loggedIn: false })
  assert.equal(claimedBy, '')
  await service.startNcmLogin('openid-a')
  await assert.rejects(service.checkNcmLogin('openid-b'), (error) => error.code === 'NCM_OWNER_MISMATCH')
})

test('concurrent processNext calls claim a song once and avoid duplicate DeepSeek tokens', async () => {
  const store = memoryStore()
  const ncm = {
    async listLikedSongs() { return [{ id: '1', title: '夜航' }] },
    async getSongSource(id, song) { return { ...song, id, lyrics: '凌晨' } }
  }
  let releaseAi
  let aiCalls = 0
  const ai = { async completeJson() { aiCalls += 1; await new Promise((resolve) => { releaseAi = resolve }); return { summary: '夜路', naming: { fit_score: 80 } } } }
  const service = createMusicAssistantService({ store, ncm, ai, id: () => 'lease-job' })
  const job = await service.startJob('openid-a', { limit: 1, model: 'deepseek-v4-flash' })
  const first = service.processNext('openid-a', { jobId: job.id, apiKey: 'key' })
  await new Promise((resolve) => setImmediate(resolve))
  const duplicate = await service.processNext('openid-a', { jobId: job.id, apiKey: 'key' })
  assert.equal(duplicate.busy, true)
  assert.equal(aiCalls, 1)
  releaseAi()
  assert.equal((await first).progress.completed, 1)
})
