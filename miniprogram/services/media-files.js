const MANAGED_DIRECTORY = 'cocktail-glassware'
const RECIPE_MANAGED_DIRECTORY = 'cocktail-recipes'
const PROFILE_MANAGED_DIRECTORY = 'cocktail-profile'

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
  const recipeManagedDirectory = `${String(userDataPath).replace(/\/$/, '')}/${RECIPE_MANAGED_DIRECTORY}`
  const recipeManagedPrefix = `${recipeManagedDirectory}/`
  const profileManagedDirectory = `${String(userDataPath).replace(/\/$/, '')}/${PROFILE_MANAGED_DIRECTORY}`
  const profileManagedPrefix = `${profileManagedDirectory}/`

  function isPathWithin(path, prefix) {
    if (typeof path !== 'string' || !path.startsWith(prefix)) return false
    const fileName = path.slice(prefix.length)
    return Boolean(fileName && !fileName.includes('/') && fileName !== '.' && fileName !== '..')
  }

  function isManagedPath(path) { return isPathWithin(path, managedPrefix) || isPathWithin(path, recipeManagedPrefix) || isPathWithin(path, profileManagedPrefix) }
  function isManagedProfilePath(path) { return isPathWithin(path, profileManagedPrefix) }

  async function ensureDirectory(directory) {
    try {
      if (typeof fileSystem.mkdir === 'function') await callbackOperation(fileSystem, 'mkdir', { dirPath: directory, recursive: true })
      else if (typeof fileSystem.mkdirSync === 'function') fileSystem.mkdirSync(directory, true)
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

  async function saveTemporaryFile(tempFilePath, filePath) {
    if (typeof fileSystem.saveFile === 'function') return callbackOperation(fileSystem, 'saveFile', { tempFilePath, filePath })
    if (typeof fileSystem.saveFileSync === 'function') return fileSystem.saveFileSync(tempFilePath, filePath)
    return copyFile(tempFilePath, filePath)
  }

  async function persistImage(sourcePath, directory, prefix, saveTemporary = false) {
    const path = String(sourcePath || '').trim()
    if (!path) return { path: '', created: false }
    if (isPathWithin(path, prefix)) return { path, created: false }
    await ensureDirectory(directory)
    const destination = `${prefix}${safeFileId(idFactory())}${extensionFor(path)}`
    if (saveTemporary) await saveTemporaryFile(path, destination)
    else await copyFile(path, destination)
    return { path: destination, created: true }
  }

  function persistGlasswareImage(sourcePath) { return persistImage(sourcePath, managedDirectory, managedPrefix) }
  function persistRecipeImage(sourcePath) { return persistImage(sourcePath, recipeManagedDirectory, recipeManagedPrefix) }
  function persistProfileImage(sourcePath) { return persistImage(sourcePath, profileManagedDirectory, profileManagedPrefix, true) }

  async function removeManagedFile(path) {
    if (!isManagedPath(path)) return { removed: false }
    if (typeof fileSystem.unlink === 'function') await callbackOperation(fileSystem, 'unlink', { filePath: path })
    else if (typeof fileSystem.unlinkSync === 'function') fileSystem.unlinkSync(path)
    else throw new Error('unlink unavailable')
    return { removed: true }
  }

  return { managedDirectory, recipeManagedDirectory, profileManagedDirectory, isManagedPath, isManagedProfilePath, persistGlasswareImage, persistRecipeImage, persistProfileImage, removeManagedFile }
}

function createWxMediaFileService(wxApi) {
  return createMediaFileService({ fileSystem: wxApi.getFileSystemManager(), userDataPath: wxApi.env && wxApi.env.USER_DATA_PATH })
}

module.exports = { MANAGED_DIRECTORY, RECIPE_MANAGED_DIRECTORY, PROFILE_MANAGED_DIRECTORY, createMediaFileService, createWxMediaFileService }
