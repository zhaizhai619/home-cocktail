function callbackOperation(target, method, options) {
  return new Promise((resolve, reject) => target[method]({ ...options, success: resolve, fail: reject }))
}

function backupFileStamp(date) {
  const iso = date.toISOString()
  return `${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, '')}`
}

function createWxBackupService(wxApi, { now = () => new Date() } = {}) {
  if (!wxApi || !wxApi.env || !wxApi.env.USER_DATA_PATH || typeof wxApi.getFileSystemManager !== 'function') {
    throw new Error('备份服务不可用')
  }
  const fileSystem = wxApi.getFileSystemManager()

  async function exportSnapshot(snapshot) {
    const exportedAt = now()
    const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt)
    const filePath = `${String(wxApi.env.USER_DATA_PATH).replace(/\/$/, '')}/cocktail-backup-${backupFileStamp(date)}.json`
    const data = JSON.stringify({
      format: 'home-cocktail-backup',
      version: 1,
      exportedAt: date.toISOString(),
      snapshot
    }, null, 2)
    await callbackOperation(fileSystem, 'writeFile', { filePath, data, encoding: 'utf8' })
    return { filePath, fileName: filePath.split('/').pop() }
  }

  return { exportSnapshot }
}

module.exports = { createWxBackupService }
