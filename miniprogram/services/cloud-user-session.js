const CLOUD_CACHE_KEY = 'home-cocktail-cloud-cache-v1'

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function validRevision(value) {
  const revision = Number(value)
  return Number.isInteger(revision) && revision >= 0 ? revision : 0
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function createCloudUserSession({
  transport,
  cache,
  initialState,
  initialProfile,
  cacheKey = CLOUD_CACHE_KEY,
  requestIdFactory = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  now = () => new Date().toISOString()
} = {}) {
  if (!transport || typeof transport.load !== 'function') throw new Error('Cloud transport unavailable')
  if (!cache || typeof cache.get !== 'function' || typeof cache.set !== 'function') throw new Error('Cloud cache unavailable')

  const cached = cache.get(cacheKey)
  let snapshot = {
    state: clone(cached && cached.state !== undefined ? cached.state : initialState),
    profile: clone(cached && cached.profile !== undefined ? cached.profile : initialProfile),
    revision: validRevision(cached && cached.revision),
    syncedAt: String(cached && cached.syncedAt || '')
  }
  let online = false
  let initialized = false
  let queue = Promise.resolve()
  const subscribers = new Set()

  function getSnapshot() {
    return clone(snapshot)
  }

  function notify() {
    const value = getSnapshot()
    for (const subscriber of subscribers) subscriber(value)
  }

  function persist() {
    cache.set(cacheKey, getSnapshot())
  }

  function applyConfirmed(next) {
    snapshot = {
      state: clone(next.state !== undefined ? next.state : snapshot.state),
      profile: clone(next.profile !== undefined ? next.profile : snapshot.profile),
      revision: validRevision(next.revision !== undefined ? next.revision : snapshot.revision),
      syncedAt: String(next.syncedAt || now())
    }
    persist()
    notify()
  }

  async function initialize() {
    try {
      const remote = await transport.load()
      applyConfirmed({
        state: remote && remote.state != null ? remote.state : initialState,
        profile: remote && remote.profile != null ? remote.profile : initialProfile,
        revision: remote && remote.revision,
        syncedAt: now()
      })
      online = true
      initialized = true
      return { online: true, syncedAt: snapshot.syncedAt }
    } catch (error) {
      online = false
      initialized = true
      return { online: false, syncedAt: snapshot.syncedAt, error }
    }
  }

  function requireWritable() {
    if (!initialized || !online) throw new Error('当前离线，只能查看；联网后才能保存')
  }

  function enqueue(work) {
    const operation = queue.then(work, work)
    queue = operation.catch(() => {})
    return operation
  }

  function mutateState(buildMutation) {
    return enqueue(async () => {
      requireWritable()
      const built = buildMutation(clone(snapshot.state)) || {}
      let response
      try {
        response = await transport.saveState({
          state: clone(built.state),
          expectedRevision: snapshot.revision,
          requestId: requestIdFactory()
        })
      } catch (error) {
        try {
          const remote = await transport.load()
          online = true
          applyConfirmed({
            state: remote && remote.state != null ? remote.state : initialState,
            profile: remote && remote.profile != null ? remote.profile : initialProfile,
            revision: remote && remote.revision,
            syncedAt: now()
          })
          if (sameValue(snapshot.state, built.state)) return clone(built.value)
        } catch (_) {
          online = false
        }
        throw error
      }
      applyConfirmed({ state: built.state, revision: response && response.revision, syncedAt: now() })
      return clone(built.value)
    })
  }

  function mutateProfile(buildMutation) {
    return enqueue(async () => {
      requireWritable()
      const built = buildMutation(clone(snapshot.profile)) || {}
      let response
      try {
        response = await transport.saveProfile({
          profile: clone(built.profile),
          expectedRevision: snapshot.revision,
          requestId: requestIdFactory()
        })
      } catch (error) {
        try {
          const remote = await transport.load()
          online = true
          applyConfirmed({
            state: remote && remote.state != null ? remote.state : initialState,
            profile: remote && remote.profile != null ? remote.profile : initialProfile,
            revision: remote && remote.revision,
            syncedAt: now()
          })
          if (sameValue(snapshot.profile, built.profile)) return clone(built.value)
        } catch (_) {
          online = false
        }
        throw error
      }
      applyConfirmed({ profile: built.profile, revision: response && response.revision, syncedAt: now() })
      return clone(built.value)
    })
  }

  function listTrash() {
    return enqueue(async () => {
      requireWritable()
      if (typeof transport.listTrash !== 'function') throw new Error('回收站服务不可用')
      return clone(await transport.listTrash()) || []
    })
  }

  function restoreTrash(trashId) {
    return enqueue(async () => {
      requireWritable()
      if (typeof transport.restoreTrash !== 'function') throw new Error('恢复服务不可用')
      const response = await transport.restoreTrash({
        trashId: String(trashId || ''),
        expectedRevision: snapshot.revision,
        requestId: requestIdFactory()
      })
      applyConfirmed({ state: response && response.state, revision: response && response.revision, syncedAt: now() })
      return getSnapshot()
    })
  }

  return {
    initialize,
    getSnapshot,
    isOnline: () => online,
    mutateState,
    mutateProfile,
    listTrash,
    restoreTrash,
    subscribe(subscriber) {
      if (typeof subscriber !== 'function') return () => {}
      subscribers.add(subscriber)
      return () => subscribers.delete(subscriber)
    }
  }
}

module.exports = { CLOUD_CACHE_KEY, createCloudUserSession }
