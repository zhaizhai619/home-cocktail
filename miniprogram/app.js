const { createRepository, createWxStorageAdapter } = require('./services/repository')
const { createWxMediaFileService } = require('./services/media-files')
const { createProfileRepository } = require('./services/profile-repository')

App({
  onLaunch() {
    const storage = createWxStorageAdapter(wx)
    const repository = createRepository(storage)
    const profileRepository = createProfileRepository(storage)
    repository.initialize()
    profileRepository.initialize()
    this.globalData = { ...(this.globalData || {}), repository, profileRepository, mediaFiles: createWxMediaFileService(wx) }
  },
  globalData: {}
})
