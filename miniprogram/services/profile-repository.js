const PROFILE_STORAGE_KEY = 'home-cocktail-profile'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function defaultIdFactory() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

function publicId(value) {
  const normalized = String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  return (normalized || defaultIdFactory().toUpperCase()).slice(-6).padStart(6, '0')
}

function createProfileRepository(adapter, options = {}) {
  const idFactory = options.idFactory || defaultIdFactory
  const now = options.now || (() => new Date().toISOString())
  let profile = null

  function normalize(raw, fallbackId) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const id = publicId(source.id || fallbackId)
    const nickname = String(source.nickname || '').trim() || `酒友 ${id}`
    return {
      id,
      nickname,
      avatarPath: String(source.avatarPath || '').trim(),
      updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : now()
    }
  }

  function initialize() {
    const raw = adapter.get(PROFILE_STORAGE_KEY)
    profile = normalize(raw, idFactory())
    adapter.set(PROFILE_STORAGE_KEY, clone(profile))
    return clone(profile)
  }

  function current() {
    return profile || initialize()
  }

  function getProfile() {
    return clone(current())
  }

  function saveProfile(value = {}) {
    const nickname = value.nickname === undefined ? current().nickname : String(value.nickname).trim()
    if (!nickname) throw new RangeError('名字不能为空')
    const next = {
      ...current(),
      nickname,
      avatarPath: value.avatarPath === undefined ? current().avatarPath : String(value.avatarPath || '').trim(),
      updatedAt: now()
    }
    adapter.set(PROFILE_STORAGE_KEY, clone(next))
    profile = next
    return clone(profile)
  }

  return { initialize, getProfile, saveProfile }
}

module.exports = { PROFILE_STORAGE_KEY, createProfileRepository }
