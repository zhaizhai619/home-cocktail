const crypto = require('crypto')

const JOBS = 'music_analysis_jobs'
const PROFILES = 'music_song_profiles'
const PROFILE_CACHE = 'music_song_profile_cache'
const SERVICE_CONFIG = 'music_service_config'
const NAMING_FEEDBACK = 'music_naming_feedback'
const COLLECTIONS = [JOBS, PROFILES, PROFILE_CACHE, SERVICE_CONFIG, NAMING_FEEDBACK]

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function missing(error) {
  return /not exist|does not exist|DOCUMENT_NOT_FOUND|-502005/i.test(String(error && (error.errMsg || error.message) || ''))
}

function documentId(...parts) {
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex')
}

function createMusicStore(db) {
  if (!db || typeof db.collection !== 'function') throw new Error('Cloud database unavailable')
  let ready

  async function ensureCollections() {
    if (!ready) ready = Promise.all(COLLECTIONS.map(async (name) => {
      try { await db.collection(name).limit(1).get() } catch (error) {
        if (!missing(error) || typeof db.createCollection !== 'function') throw error
        try { await db.createCollection(name) } catch (createError) {
          if (!/already exist|已存在/i.test(String(createError && (createError.errMsg || createError.message)))) throw createError
        }
      }
    })).catch((error) => { ready = null; throw error })
    return ready
  }

  async function readDocument(target, collection, id) {
    try {
      const result = await target.collection(collection).doc(id).get()
      return result && result.data ? clone(result.data) : null
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
  }

  async function getDocument(collection, id) {
    await ensureCollections()
    return readDocument(db, collection, id)
  }

  function jobData(owner, job) {
    const data = clone({ ...job, ownerOpenId: owner })
    delete data._id
    return data
  }

  async function setJobDocument(target, owner, job, updateLatest = false) {
    const data = jobData(owner, job)
    await target.collection(JOBS).doc(documentId(owner, job.id)).set({ data })
    if (updateLatest) await target.collection(JOBS).doc(documentId(owner, 'latest')).set({ data })
    return data
  }

  async function setJobAndCurrentLatest(transaction, owner, job) {
    const latest = await readDocument(transaction, JOBS, documentId(owner, 'latest'))
    await setJobDocument(transaction, owner, job, false)
    if (!latest || latest.id === job.id) await transaction.collection(JOBS).doc(documentId(owner, 'latest')).set({ data: jobData(owner, job) })
  }

  return {
    ensureCollections,
    async saveJob(owner, job) {
      await ensureCollections()
      const data = await setJobDocument(db, owner, job, true)
      return clone(data)
    },
    async saveJobState(owner, job) {
      await ensureCollections()
      return db.runTransaction(async (transaction) => {
        await setJobAndCurrentLatest(transaction, owner, job)
        return clone(jobData(owner, job))
      })
    },
    getJob(owner, id) { return getDocument(JOBS, documentId(owner, id)) },
    getLatestJob(owner) { return getDocument(JOBS, documentId(owner, 'latest')) },
    async listRunnableJobs(limit = 10) {
      await ensureCollections()
      const max = Math.max(1, Math.min(50, Number(limit) || 10))
      const [queued, running] = await Promise.all([
        db.collection(JOBS).where({ status: 'queued' }).limit(max * 2).get(),
        db.collection(JOBS).where({ status: 'running' }).limit(max * 2).get()
      ])
      const unique = new Map()
      for (const job of [...queued.data || [], ...running.data || []]) {
        const key = `${job.ownerOpenId || ''}:${job.id || ''}`
        if (job.ownerOpenId && job.id && !unique.has(key)) unique.set(key, clone(job))
      }
      return [...unique.values()].sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))).slice(0, max)
    },
    findProfile(owner, cacheKey) { return getDocument(PROFILE_CACHE, documentId(owner, cacheKey)) },
    async saveProfile(owner, profile) {
      await ensureCollections()
      const source = clone(profile) || {}
      delete source._id
      delete source.ownerOpenId
      delete source.preferredTitle
      delete source.preferred_title
      const data = clone({
        title: source.title,
        artist: source.artist,
        album: source.album,
        emotion_keywords: source.emotion_keywords,
        scene_sensory_keywords: source.scene_sensory_keywords,
        summary: source.summary,
        fitScore: source.fitScore,
        ...source,
        ownerOpenId: owner
      })
      await db.collection(PROFILE_CACHE).doc(documentId(owner, profile.cacheKey)).set({ data })
      await db.collection(PROFILES).doc(documentId(owner, profile.songId)).set({ data })
      return clone(data)
    },
    async listProfiles(owner) {
      await ensureCollections()
      const result = await db.collection(PROFILES).where({ ownerOpenId: owner }).limit(300).get()
      return clone(result && result.data || [])
    },
    async countProfiles(owner) {
      await ensureCollections()
      const result = await db.collection(PROFILES).where({ ownerOpenId: owner }).count()
      return Number(result && result.total) || 0
    },
    async saveNamingFeedback(owner, feedback) {
      await ensureCollections()
      const data = clone({ ...feedback, ownerOpenId: owner })
      delete data._id
      await db.collection(NAMING_FEEDBACK).doc(documentId(owner, feedback.id)).set({ data })
      return clone(data)
    },
    async listNamingFeedback(owner, limit = 50) {
      await ensureCollections()
      const max = Math.max(1, Math.min(100, Number(limit) || 50))
      const result = await db.collection(NAMING_FEEDBACK).where({ ownerOpenId: owner }).limit(max).get()
      return clone(result && result.data || [])
    },
    async claimNcmOwner(owner) {
      await ensureCollections()
      return db.runTransaction(async (transaction) => {
        const id = 'ncm-single-account-owner'
        const current = await readDocument(transaction, SERVICE_CONFIG, id)
        if (current && current.ownerOpenId !== owner) {
          const error = new Error('体验版网易云账号已由其他微信用户连接')
          error.code = 'NCM_OWNER_MISMATCH'
          throw error
        }
        if (!current) await transaction.collection(SERVICE_CONFIG).doc(id).set({ data: { ownerOpenId: owner, createdAt: new Date().toISOString() } })
        return true
      })
    },
    async checkNcmOwner(owner) {
      const current = await getDocument(SERVICE_CONFIG, 'ncm-single-account-owner')
      if (!current) return false
      if (current.ownerOpenId !== owner) {
        const error = new Error('体验版网易云账号已由其他微信用户连接')
        error.code = 'NCM_OWNER_MISMATCH'
        throw error
      }
      return true
    },
    async claimSong(owner, jobId, songId, lease) {
      await ensureCollections()
      return db.runTransaction(async (transaction) => {
        const current = await readDocument(transaction, JOBS, documentId(owner, jobId))
        if (!current || current.results && current.results[songId]) return { claimed: false, job: current }
        if (current.lease && current.lease.expiresAt > lease.now) return { claimed: false, job: current }
        const claimed = {
          ...current,
          status: 'running',
          currentSongId: songId,
          lease: { songId, token: lease.token, expiresAt: lease.expiresAt },
          updatedAt: lease.now
        }
        await setJobAndCurrentLatest(transaction, owner, claimed)
        return { claimed: true, job: clone(claimed) }
      })
    },
    async finishSongClaim(owner, job, token) {
      await ensureCollections()
      return db.runTransaction(async (transaction) => {
        const current = await readDocument(transaction, JOBS, documentId(owner, job.id))
        if (!current || !current.lease || current.lease.token !== token) return current
        const finished = clone(job)
        delete finished.lease
        await setJobAndCurrentLatest(transaction, owner, finished)
        return finished
      })
    },
    async releaseSongClaim(owner, jobId, token, releasedAt) {
      await ensureCollections()
      return db.runTransaction(async (transaction) => {
        const current = await readDocument(transaction, JOBS, documentId(owner, jobId))
        if (!current || !current.lease || current.lease.token !== token) return current
        const released = { ...current, currentSongId: '', updatedAt: releasedAt || new Date().toISOString() }
        delete released.lease
        await setJobAndCurrentLatest(transaction, owner, released)
        return released
      })
    }
  }
}

module.exports = { JOBS, PROFILES, PROFILE_CACHE, SERVICE_CONFIG, NAMING_FEEDBACK, createMusicStore }
