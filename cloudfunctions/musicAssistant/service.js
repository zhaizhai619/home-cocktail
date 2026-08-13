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
const { SONG_PROFILE_PROMPT_VERSION } = require('./prompts')
const { selectSongCandidates } = require('./matching')

const DEFAULT_MODEL_PARAMS = { temperature: 0.2, maxTokens: 1600, thinking: 'disabled', responseFormat: 'json_object' }

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

function publicJob(job) {
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    model: job.model,
    progress: job.progress,
    currentSongId: job.currentSongId || '',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
}

function createMusicAssistantService({
  store,
  ncm,
  ai,
  now = () => new Date().toISOString(),
  id = () => `music-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  leaseId = () => `lease-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
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
    await store.saveJob(owner, job)
    return publicJob(job)
  }

  async function processNext(openId, input = {}) {
    const owner = ownerId(openId)
    const apiKey = requiredKey(input.apiKey)
    let job = await store.getJob(owner, String(input.jobId || ''))
    if (!job) throw serviceError('JOB_NOT_FOUND', '没有找到这次歌曲解析任务')
    if (job.status === 'completed') return publicJob(job)
    const songId = job.songIds.find((candidate) => !job.results[candidate])
    if (!songId) {
      job.status = 'completed'
      job.currentSongId = ''
      job.updatedAt = now()
      await store.saveJob(owner, job)
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
      await store.saveJob(owner, job)
    }

    async function finish(updated) {
      if (typeof store.finishSongClaim === 'function') return store.finishSongClaim(owner, updated, leaseToken)
      return store.saveJob(owner, updated)
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
        await store.saveProfile(owner, { ...cached, title: identity.source.title, preferredTitle: identity.source.title, updatedAt: now() })
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
        summary: analyzed.summary,
        emotion_keywords: analyzed.emotion_keywords,
        scene_sensory_keywords: analyzed.scene_sensory_keywords,
        preferredTitle: identity.source.title,
        fitScore: analyzed.naming.fit_score,
        namingRisks: analyzed.naming.risks,
        analysisConfidence: analyzed.analysis_confidence,
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

  async function recommendNames(openId, input = {}) {
    const owner = ownerId(openId)
    const apiKey = requiredKey(input.apiKey)
    const model = requireModel(input.model)
    const profiles = await store.listProfiles(owner)
    if (!profiles.length) throw serviceError('NO_SONG_PROFILES', '请先导入并解析喜欢的歌曲')
    const rawCocktail = await ai.completeJson({
      apiKey,
      model,
      messages: buildCocktailProfileMessages(input),
      temperature: 0.2,
      maxTokens: 900
    })
    const cocktailProfile = normalizeCocktailProfile(rawCocktail)
    const candidates = selectSongCandidates(cocktailProfile, profiles, 12)
    const rawNaming = await ai.completeJson({
      apiKey,
      model,
      messages: buildNamingMessages({ cocktail: cocktailProfile, candidates }),
      temperature: 0.45,
      maxTokens: 1000
    })
    const candidateById = new Map(candidates.map((item) => [item.songId, item]))
    const recommendations = normalizeRecommendations(rawNaming).filter((item) => candidateById.has(item.song_id)).map((item) => ({
      ...item,
      recommended_name: candidateById.get(item.song_id).title
    }))
    if (!recommendations.length) throw serviceError('NO_RECOMMENDATIONS', '暂时没有找到合适的歌曲名，请换一种偏好再试')
    return { cocktailProfile, recommendations }
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

  return { getStatus, startJob, processNext, recommendNames, startNcmLogin, checkNcmLogin }
}

module.exports = { DEFAULT_MODEL_PARAMS, createMusicAssistantService, serviceError }
