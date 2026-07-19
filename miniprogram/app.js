const { createRepository, createWxStorageAdapter } = require('./services/repository')
const { createWxMediaFileService } = require('./services/media-files')

App({
  onLaunch() {
    const repository = createRepository(createWxStorageAdapter(wx))
    repository.initialize()
    this.globalData = { ...(this.globalData || {}), repository, mediaFiles: createWxMediaFileService(wx) }
  },
  globalData: {}
})
