const {
  buildAnalysisIdentity,
  createAnalysisJob,
  applySongResult
} = require('./domain')
const {
  buildSongProfileMessages,
  buildCocktailProfileMessages,
  buildNamingMessages,
  normalizeSongProfile,
  normalizeCocktailProfile,
  normalizeRecommendations
} = require('./analysis')
const { SONG_PROFILE_PROMPT_VERSION, NAMING_PROMPT_VERSION } = require('./prompts')
const { selectSongCandidates, selectRelevantNamingFeedback } = require('./matching')

const DEFAULT_MODEL_PARAMS = { temperature: 0.2, maxTokens: 1600, thinking: 'disabled', responseFormat: 'json_object' }
const DEFAULT_CREDENTIAL_TTL_MS = 6 * 60 * 60 * 1000

function serviceError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function ownerId(value) {
  const id = String(value || '').trim()
  if (!id) throw serviceError('UNAUTHENTICATED', '无法识别微信用户')
  return id
}

function requiredKey(value) {
  const key = String(value || '').trim()
  if (!key) throw serviceError('MISSING_API_KEY', '请先填写 DeepSeek API Key')
  return key
}

function requireModel(value) {
  const model = String(value || '').trim()
  if (!model || model.length > 80) throw serviceError('INVALID_MODEL', '请填写正确的大模型名称')
  return model
}

const FEEDBACK_ACTIONS = new Set(['rejected', 'used'])
const FEEDBACK_TAGS = new Set(['vibe_mismatch', 'weak_reason', 'bad_name'])

function feedbackTags(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter((item) => FEEDBACK_TAGS.has(item)))].slice(0, 3)
}

function publicJob(job) {
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    model: job.model,
    progress: job.progress,
    currentSongId: job.currentSongId || '',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    lastError: job.lastError || ''
  }
}

function credentialContext(owner, jobId) { return `${owner}:${jobId}` }

function withoutCredential(job) {
  const clean = { ...job }
  delete clean.apiCredential
  delete clean.credentialExpiresAt
  return clean
}

function processedCount(job) {
  const progress = job && job.progress || {}
  return Number(progress.completed || 0) + Number(progress.failed || 0) + Number(progress.skipped || 0)
}

function createMusicAssistantService({
  store,
  ncm,
  ai,
  now = () => new Date().toISOString(),
  id = () => `music-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  leaseId = () => `lease-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  credentials,
  credentialTtlMs = DEFAULT_CREDENTIAL_TTL_MS
} = {}) {
  if (!store || !ai) throw new Error('Music assistant dependencies unavailable')

  async function claimNcmOwner(owner) {
    if (typeof store.claimNcmOwner === 'function') await store.claimNcmOwner(owner)
  }

  async function checkNcmOwner(owner) {
    return typeof store.checkNcmOwner === 'function' ? store.checkNcmOwner(owner) : true
  }

  async function getStatus(openId) {
    const owner = ownerId(openId)
    const [job, analyzedCount] = await Promise.all([store.getLatestJob(owner), store.countProfiles(owner)])
    return { job: publicJob(job), analyzedCount: Number(analyzedCount) || 0 }
  }

  async function saveJobState(owner, job) {
    return typeof store.saveJobState === 'function' ? store.saveJobState(owner, job) : store.saveJob(owner, job)
  }

  async function startJob(openId, input = {}) {
    const owner = ownerId(openId)
    const model = requireModel(input.model)
    const limit = Math.max(1, Math.min(300, Number.parseInt(input.limit, 10) || 20))
    if (!ncm || typeof ncm.listLikedSongs !== 'function') throw serviceError('NCM_UNAVAILABLE', '网易云音乐服务尚未配置')
    await claimNcmOwner(owner)
    const songs = await ncm.listLikedSongs(limit)
    if (!songs.length) throw serviceError('NO_LIKED_SONGS', '没有读取到红心歌曲，请先确认网易云已登录且红心歌单不为空')
    const timestamp = now()
    const job = createAnalysisJob({ id: id(), songs, limit, model, now: timestamp })
    job.ownerOpenId = owner
    job.modelParams = DEFAULT_MODEL_PARAMS
    if (credentials) {
      const apiKey = requiredKey(input.apiKey)
      job.apiCredential = credentials.seal(apiKey, credentialContext(owner, job.id))
      job.credentialExpiresAt = new Date(new Date(timestamp).getTime() + credentialTtlMs).toISOString()
    }
    await store.saveJob(owner, job)
    return publicJob(job)
  }

  function apiKeyFor(owner, job, input = {}) {
    if (String(input.apiKey || '').trim()) return requiredKey(input.apiKey)
    if (!credentials || !job.apiCredential) throw serviceError('JOB_CREDENTIAL_MISSING', '后台解析凭证已失效，请点击继续进度')
    if (job.credentialExpiresAt && new Date(job.credentialExpiresAt).getTime() <= new Date(now()).getTime()) {
      throw serviceError('JOB_CREDENTIAL_EXPIRED', '后台解析凭证已过期，请点击继续进度')
    }
    return requiredKey(credentials.open(job.apiCredential, credentialContext(owner, job.id)))
  }

  async function processNext(openId, input = {}) {
    const owner = ownerId(openId)
    let job = await store.getJob(owner, String(input.jobId || ''))
    if (!job) throw serviceError('JOB_NOT_FOUND', '没有找到这次歌曲解析任务')
    if (job.status === 'completed') {
      if (job.apiCredential) await saveJobState(owner, withoutCredential(job))
      return publicJob(job)
    }
    const apiKey = apiKeyFor(owner, job, input)
    const songId = job.songIds.find((candidate) => !job.results[candidate])
    if (!songId) {
      job.status = 'completed'
      job.currentSongId = ''
      job.updatedAt = now()
      job = withoutCredential(job)
      await saveJobState(owner, job)
      return publicJob(job)
    }

    const leaseToken = leaseId()
    if (typeof store.claimSong === 'function') {
      const claimedAt = now()
      const claimed = await store.claimSong(owner, job.id, songId, {
        token: leaseToken,
        now: claimedAt,
        expiresAt: new Date(new Date(claimedAt).getTime() + 2 * 60 * 1000).toISOString()
      })
      if (!claimed || !claimed.claimed) return { ...publicJob(claimed && claimed.job || job), busy: true }
      job = claimed.job
    } else {
      job.status = 'running'
      job.currentSongId = songId
      job.updatedAt = now()
      await saveJobState(owner, job)
    }

    async function finish(updated) {
      const saved = updated.status === 'completed' ? withoutCredential(updated) : updated
      if (typeof store.finishSongClaim === 'function') return store.finishSongClaim(owner, saved, leaseToken)
      return saveJobState(owner, saved)
    }

    async function release() {
      if (typeof store.releaseSongClaim === 'function') await store.releaseSongClaim(owner, job.id, leaseToken, now())
    }
    let source
    try {
      source = await ncm.getSongSource(songId, job.songs[songId] || { id: songId })
    } catch (_) {
      const failed = applySongResult(job, { songId, status: 'failed', error: '无法读取这首歌的信息' }, now())
      await finish(failed)
      return publicJob(failed)
    }
    const identity = buildAnalysisIdentity({
      song: source,
      model: job.model,
      promptVersion: SONG_PROFILE_PROMPT_VERSION,
      modelParams: job.modelParams || DEFAULT_MODEL_PARAMS
    })
    const cached = await store.findProfile(owner, identity.cacheKey)
    if (cached) {
      try {
        await store.saveProfile(owner, { ...cached, title: identity.source.title, updatedAt: now() })
        const updated = applySongResult(job, { songId, status: 'cached' }, now())
        await finish(updated)
        return publicJob(updated)
      } catch (error) {
        await release()
        throw error
      }
    }

    let raw
    try {
      raw = await ai.completeJson({
        apiKey,
        model: job.model,
        messages: buildSongProfileMessages(identity.source),
        temperature: job.modelParams.temperature,
        maxTokens: job.modelParams.maxTokens,
        thinking: job.modelParams.thinking,
        responseFormat: job.modelParams.responseFormat
      })
    } catch (error) {
      await release()
      throw error
    }
    try {
      const analyzed = normalizeSongProfile(raw)
      await store.saveProfile(owner, {
        ownerOpenId: owner,
        cacheKey: identity.cacheKey,
        sourceFingerprint: identity.sourceFingerprint,
        analysisVersion: identity.analysisVersion,
        promptVersion: SONG_PROFILE_PROMPT_VERSION,
        model: job.model,
        modelParams: job.modelParams,
        songId,
        title: identity.source.title,
        artist: identity.source.artist,
        album: identity.source.album,
        releaseDate: identity.source.releaseDate,
        summary: analyzed.summary,
        emotion_keywords: analyzed.emotion_keywords,
        scene_sensory_keywords: analyzed.scene_sensory_keywords,
        fitScore: analyzed.naming.fit_score,
        namingRisks: analyzed.naming.risks,
        createdAt: now(),
        updatedAt: now()
      })
      const updated = applySongResult(job, { songId, status: 'completed' }, now())
      await finish(updated)
      return publicJob(updated)
    } catch (error) {
      await release()
      throw error
    }
  }

  async function pauseJob(owner, jobId, message) {
    const current = await store.getJob(owner, jobId)
    if (!current || current.status === 'completed') return current
    const paused = withoutCredential({
      ...current,
      status: 'paused',
      currentSongId: '',
      lastError: String(message || '后台解析已暂停，请稍后继续'),
      updatedAt: now()
    })
    delete paused.lease
    return saveJobState(owner, paused)
  }

  async function resumeJob(openId, input = {}) {
    const owner = ownerId(openId)
    if (!credentials) throw serviceError('CREDENTIAL_ENCRYPTION_UNAVAILABLE', '后台任务加密能力尚未配置')
    const job = await store.getJob(owner, String(input.jobId || ''))
    if (!job) throw serviceError('JOB_NOT_FOUND', '没有找到这次歌曲解析任务')
    if (job.status === 'completed') return publicJob(job)
    const timestamp = now()
    if (job.lease && new Date(job.lease.expiresAt).getTime() > new Date(timestamp).getTime()) return publicJob(job)
    const resumed = {
      ...withoutCredential(job),
      status: 'queued',
      currentSongId: '',
      lastError: '',
      apiCredential: credentials.seal(requiredKey(input.apiKey), credentialContext(owner, job.id)),
      credentialExpiresAt: new Date(new Date(timestamp).getTime() + credentialTtlMs).toISOString(),
      updatedAt: timestamp
    }
    delete resumed.lease
    await store.saveJob(owner, resumed)
    return publicJob(resumed)
  }

  async function runBackground({ maxSongs = 6 } = {}) {
    if (typeof store.listRunnableJobs !== 'function') return { completed: 0, paused: 0 }
    const max = Math.max(1, Math.min(20, Number(maxSongs) || 6))
    let completed = 0
    let paused = 0
    let attempts = 0
    while (attempts < max) {
      const jobs = await store.listRunnableJobs(Math.min(10, max - attempts))
      if (!jobs.length) break
      let progressed = false
      for (const queued of jobs) {
        if (attempts >= max) break
        attempts += 1
        try {
          const before = processedCount(queued)
          const result = await processNext(queued.ownerOpenId, { jobId: queued.id })
          if (result && result.busy) continue
          const delta = Math.max(0, processedCount(result) - before)
          completed += delta
          progressed = progressed || delta > 0 || result.status === 'completed'
        } catch (error) {
          await pauseJob(queued.ownerOpenId, queued.id, error && error.message)
          paused += 1
          progressed = true
        }
      }
      if (!progressed) break
    }
    return { completed, paused }
  }

  async function recommendNames(openId, input = {}) {
    const owner = ownerId(openId)
    const apiKey = requiredKey(input.apiKey)
    const model = requireModel(input.model)
    const [profiles, feedback] = await Promise.all([
      store.listProfiles(owner),
      typeof store.listNamingFeedback === 'function' ? store.listNamingFeedback(owner, 50) : []
    ])
    if (!profiles.length) throw serviceError('NO_SONG_PROFILES', '请先导入并解析喜欢的歌曲')
    const rawCocktail = await ai.completeJson({
      apiKey,
      model,
      messages: buildCocktailProfileMessages(input),
      temperature: 0.2,
      maxTokens: 900
    })
    const cocktailProfile = normalizeCocktailProfile(rawCocktail)
    const excludeSongIds = [...new Set((Array.isArray(input.excludeSongIds) ? input.excludeSongIds : []).map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 100)
    const candidates = selectSongCandidates(cocktailProfile, profiles, 12, { excludeSongIds, feedback })
    const feedbackExamples = selectRelevantNamingFeedback(cocktailProfile, feedback, 6)
    const rawNaming = await ai.completeJson({
      apiKey,
      model,
      messages: buildNamingMessages({ cocktail: cocktailProfile, sourceCocktail: input, candidates, feedbackExamples }),
      temperature: 0.45,
      maxTokens: 1000
    })
    const candidateById = new Map(candidates.map((item) => [item.songId, item]))
    const recommendations = normalizeRecommendations(rawNaming).filter((item) => candidateById.has(item.song_id)).map((item) => ({
      ...item,
      recommended_name: candidateById.get(item.song_id).title,
      artist: candidateById.get(item.song_id).artist
    }))
    if (!recommendations.length) throw serviceError('NO_RECOMMENDATIONS', '暂时没有找到合适的歌曲名，请换一种偏好再试')
    return { cocktailProfile, recommendations }
  }

  async function submitNamingFeedback(openId, input = {}) {
    const owner = ownerId(openId)
    const songId = String(input.songId || '').trim()
    const action = String(input.feedbackAction || '').trim()
    if (!songId) throw serviceError('INVALID_FEEDBACK', '缺少需要反馈的歌曲')
    if (!FEEDBACK_ACTIONS.has(action)) throw serviceError('INVALID_FEEDBACK', '请选择正确的反馈类型')
    if (!store.saveNamingFeedback) throw serviceError('FEEDBACK_UNAVAILABLE', '反馈服务暂不可用')
    const tags = action === 'rejected' ? feedbackTags(input.tags) : []
    const feedback = {
      id: id(),
      songId,
      title: String(input.title || '').trim().slice(0, 120),
      artist: String(input.artist || '').trim().slice(0, 160),
      action,
      tags,
      note: String(input.note || '').trim().slice(0, 240),
      reason: String(input.reason || '').trim().slice(0, 360),
      cocktailProfile: normalizeCocktailProfile(input.cocktailProfile),
      model: String(input.model || '').trim().slice(0, 80),
      promptVersion: NAMING_PROMPT_VERSION,
      createdAt: now()
    }
    await store.saveNamingFeedback(owner, feedback)
    return { id: feedback.id, songId, action, tags, createdAt: feedback.createdAt }
  }

  async function startNcmLogin(openId) {
    const owner = ownerId(openId)
    if (!ncm || typeof ncm.startLogin !== 'function') throw serviceError('NCM_UNAVAILABLE', '网易云音乐服务尚未配置')
    await claimNcmOwner(owner)
    return ncm.startLogin()
  }

  async function checkNcmLogin(openId) {
    const owner = ownerId(openId)
    if (!ncm || typeof ncm.loginStatus !== 'function') throw serviceError('NCM_UNAVAILABLE', '网易云音乐服务尚未配置')
    if (!await checkNcmOwner(owner)) return { loggedIn: false }
    return ncm.loginStatus()
  }

  return { getStatus, startJob, resumeJob, processNext, runBackground, recommendNames, submitNamingFeedback, startNcmLogin, checkNcmLogin }
}

module.exports = { DEFAULT_MODEL_PARAMS, DEFAULT_CREDENTIAL_TTL_MS, createMusicAssistantService, serviceError }
