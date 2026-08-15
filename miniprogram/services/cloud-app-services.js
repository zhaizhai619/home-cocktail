const { createInitialState, migrateState } = require('./schema')
const { createProfileRepository } = require('./profile-repository')
const { createCloudUserSession, CLOUD_CACHE_KEY } = require('./cloud-user-session')
const { createCloudRepository, createCloudProfileRepository } = require('./cloud-repository')
const { createWxCloudTransport } = require('./wx-cloud-transport')
const { createWxCloudMediaFileService } = require('./media-files')
const { createMusicAssistantClient, createMusicAssistantSettings } = require('./music-assistant')

function createInitialProfile({ idFactory, now } = {}) {
  const memory = { value: undefined }
  const repository = createProfileRepository({
    get() { return memory.value },
    set(_, value) { memory.value = value }
  }, { idFactory, now })
  return repository.initialize()
}

function normalizeCloudState(state) {
  const migrated = migrateState(state)
  return state && typeof state === 'object' && !Array.isArray(state) ? { ...state, ...migrated } : migrated
}

function createCloudAppServices({ wxApi, envId, profileIdFactory, now } = {}) {
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.init !== 'function') throw new Error('微信云开发不可用')
  if (!envId) throw new Error('云环境未配置')

  wxApi.cloud.init({ env: envId, traceUser: true })
  const cache = {
    get(key) { return wxApi.getStorageSync(key) },
    set(key, value) { wxApi.setStorageSync(key, value) }
  }
  const session = createCloudUserSession({
    transport: createWxCloudTransport({ cloud: wxApi.cloud }),
    cache,
    cacheKey: CLOUD_CACHE_KEY,
    initialState: createInitialState(),
    initialProfile: createInitialProfile({ idFactory: profileIdFactory, now }),
    normalizeState: normalizeCloudState,
    now
  })
  const repository = createCloudRepository(session, { now })
  const profileRepository = createCloudProfileRepository(session, { now })
  const mediaFiles = createWxCloudMediaFileService(wxApi)
  const musicAssistant = createMusicAssistantClient(wxApi.cloud)
  const musicAssistantSettings = createMusicAssistantSettings(wxApi)
  const ready = session.initialize()

  return { repository, profileRepository, mediaFiles, musicAssistant, musicAssistantSettings, cloudSession: session, ready }
}

module.exports = { createCloudAppServices }
