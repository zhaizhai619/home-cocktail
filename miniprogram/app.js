const { createCloudAppServices } = require('./services/cloud-app-services')

const CLOUD_ENV_ID = 'cloud1-d3gbs4a2yb36e552b'

App({
  onLaunch() {
    try {
      const services = createCloudAppServices({ wxApi: wx, envId: CLOUD_ENV_ID })
      this.globalData = { ...(this.globalData || {}), ...services, cloudStatus: { online: false, syncedAt: '' } }
      services.cloudSession.subscribe((snapshot) => {
        this.globalData.cloudStatus = { online: services.cloudSession.isOnline(), syncedAt: snapshot.syncedAt }
      })
      this.globalData.ready = services.ready.then((status) => {
        this.globalData.cloudStatus = { online: status.online, syncedAt: status.syncedAt || '', error: status.error }
        if (!status.online && status.error) console.warn('cloud initialization failed', status.error)
        return status
      })
    } catch (error) {
      this.globalData = {
        ...(this.globalData || {}),
        cloudStatus: { online: false, syncedAt: '', error },
        ready: Promise.resolve({ online: false, syncedAt: '', error })
      }
    }
  },
  onShow() {
    const data = this.globalData || {}
    if (!data.cloudSession || !data.ready) return
    data.ready = Promise.resolve(data.ready).then((status) => (
      status && status.online ? status : data.cloudSession.initialize()
    )).then((status) => {
      data.cloudStatus = { online: status.online, syncedAt: status.syncedAt || '', error: status.error }
      if (!status.online && status.error) console.warn('cloud reconnect failed', status.error)
      return status
    })
  },
  globalData: {}
})
