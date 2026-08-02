async function waitForCloudReady() {
  const app = typeof getApp === 'function' ? getApp() : null
  const ready = app && app.globalData && app.globalData.ready
  if (ready && typeof ready.then === 'function') await ready
  return app && app.globalData ? app.globalData : {}
}

module.exports = { waitForCloudReady }
