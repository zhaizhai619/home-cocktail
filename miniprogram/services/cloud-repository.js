const { STORAGE_KEY } = require('./schema')
const { createRepository } = require('./repository')
const { PROFILE_STORAGE_KEY, createProfileRepository } = require('./profile-repository')

const READ_METHODS = new Set([
  'getState',
  'listRecipes', 'getRecipe',
  'listMaterials', 'getMaterial', 'getMaterialUsageCount',
  'listGlassware', 'getGlassware', 'getGlasswareUsageCount',
  'listTools', 'getTool', 'getToolUsageCount'
])

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function memoryAdapter(key, value) {
  let current = clone(value)
  return {
    get(requestedKey) { return requestedKey === key ? clone(current) : undefined },
    set(requestedKey, next) { if (requestedKey === key) current = clone(next) }
  }
}

function repositoryForState(state, options) {
  const repository = createRepository(memoryAdapter(STORAGE_KEY, state), options)
  repository.initialize()
  return repository
}

function profileRepositoryForValue(profile, options) {
  const repository = createProfileRepository(memoryAdapter(PROFILE_STORAGE_KEY, profile), options)
  repository.initialize()
  return repository
}

function createCloudRepository(session, options = {}) {
  if (!session || typeof session.getSnapshot !== 'function') throw new Error('Cloud session unavailable')
  let reader = repositoryForState(session.getSnapshot().state, options)
  session.subscribe((next) => { reader = repositoryForState(next.state, options) })

  const cloudRepository = { initialize: () => reader.getState() }
  for (const method of Object.keys(reader)) {
    if (method === 'initialize') continue
    if (READ_METHODS.has(method)) {
      cloudRepository[method] = (...args) => reader[method](...args)
      continue
    }
    cloudRepository[method] = (...args) => session.mutateState((baseState) => {
      const candidate = repositoryForState(baseState, options)
      const value = candidate[method](...args)
      return { state: candidate.getState(), value }
    })
  }
  return cloudRepository
}

function createCloudProfileRepository(session, options = {}) {
  if (!session || typeof session.getSnapshot !== 'function') throw new Error('Cloud session unavailable')
  let reader = profileRepositoryForValue(session.getSnapshot().profile, options)
  session.subscribe((next) => { reader = profileRepositoryForValue(next.profile, options) })
  return {
    initialize: () => reader.getProfile(),
    getProfile: () => reader.getProfile(),
    saveProfile(value) {
      return session.mutateProfile((baseProfile) => {
        const candidate = profileRepositoryForValue(baseProfile, options)
        const saved = candidate.saveProfile(value)
        return { profile: candidate.getProfile(), value: saved }
      })
    }
  }
}

module.exports = { createCloudRepository, createCloudProfileRepository }
