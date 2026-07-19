const { createRepository, createWxStorageAdapter } = require('./services/repository')

App({
  onLaunch() {
    const repository = createRepository(createWxStorageAdapter(wx))
    repository.initialize()
    this.globalData = { ...(this.globalData || {}), repository }
  },
  globalData: {}
})
