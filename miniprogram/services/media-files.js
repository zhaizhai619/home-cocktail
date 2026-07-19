const MANAGED_DIRECTORY = 'cocktail-glassware'

function extensionFor(path) {
  const match = String(path || '').match(/\.([a-zA-Z0-9]{1,8})$/)
  return match ? `.${match[1].toLowerCase()}` : '.img'
}

function safeFileId(value) {
  const normalized = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '')
  return normalized || `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function callbackOperation(target, method, options) {
  return new Promise((resolve, reject) => target[method]({ ...options, success: resolve, fail: reject }))
}

function createMediaFileService({ fileSystem, userDataPath, idFactory = () => `${Date.now()}-${Math.random().toString(36).slice(2)}` } = {}) {
  if (!fileSystem || !userDataPath) throw new Error('Media file service unavailable')
  const managedDirectory = `${String(userDataPath).replace(/\/$/, '')}/${MANAGED_DIRECTORY}`
  const managedPrefix = `${managedDirectory}/`

  function isManagedPath(path) {
    if (typeof path !== 'string' || !path.startsWith(managedPrefix)) return false
    const fileName = path.slice(managedPrefix.length)
    return Boolean(fileName && !fileName.includes('/') && fileName !== '.' && fileName !== '..')
  }

  async function ensureDirectory() {
    try {
      if (typeof fileSystem.mkdir === 'function') await callbackOperation(fileSystem, 'mkdir', { dirPath: managedDirectory, recursive: true })
      else if (typeof fileSystem.mkdirSync === 'function') fileSystem.mkdirSync(managedDirectory, true)
      else throw new Error('mkdir unavailable')
    } catch (error) {
      if (!/exist/i.test(String(error && (error.errMsg || error.message)))) throw error
    }
  }

  async function copyFile(srcPath, destPath) {
    if (typeof fileSystem.copyFile === 'function') return callbackOperation(fileSystem, 'copyFile', { srcPath, destPath })
    if (typeof fileSystem.copyFileSync === 'function') return fileSystem.copyFileSync(srcPath, destPath)
    if (typeof fileSystem.saveFile === 'function') return callbackOperation(fileSystem, 'saveFile', { tempFilePath: srcPath, filePath: destPath })
    if (typeof fileSystem.saveFileSync === 'function') return fileSystem.saveFileSync(srcPath, destPath)
    throw new Error('copy unavailable')
  }

  async function persistGlasswareImage(sourcePath) {
    const path = String(sourcePath || '').trim()
    if (!path) return { path: '', created: false }
    if (isManagedPath(path)) return { path, created: false }
    await ensureDirectory()
    const destination = `${managedPrefix}${safeFileId(idFactory())}${extensionFor(path)}`
    await copyFile(path, destination)
    return { path: destination, created: true }
  }

  async function removeManagedFile(path) {
    if (!isManagedPath(path)) return { removed: false }
    if (typeof fileSystem.unlink === 'function') await callbackOperation(fileSystem, 'unlink', { filePath: path })
    else if (typeof fileSystem.unlinkSync === 'function') fileSystem.unlinkSync(path)
    else throw new Error('unlink unavailable')
    return { removed: true }
  }

  return { managedDirectory, isManagedPath, persistGlasswareImage, removeManagedFile }
}

function createWxMediaFileService(wxApi) {
  return createMediaFileService({ fileSystem: wxApi.getFileSystemManager(), userDataPath: wxApi.env && wxApi.env.USER_DATA_PATH })
}

module.exports = { MANAGED_DIRECTORY, createMediaFileService, createWxMediaFileService }
