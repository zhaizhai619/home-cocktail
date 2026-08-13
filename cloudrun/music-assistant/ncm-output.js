const crypto = require('crypto')
const path = require('path')

function findValue(value, keys) {
  if (!value || typeof value !== 'object') return undefined
  for (const key of keys) if (value[key] !== undefined) return value[key]
  for (const nested of Object.values(value)) {
    const found = findValue(nested, keys)
    if (found !== undefined) return found
  }
  return undefined
}

function findSongArray(value) {
  if (Array.isArray(value) && value.some((item) => item && typeof item === 'object' && (item.id || item.songId) && (item.name || item.title))) return value
  if (!value || typeof value !== 'object') return []
  for (const nested of Object.values(value)) {
    const found = findSongArray(nested)
    if (found.length) return found
  }
  return []
}

function artistName(song) {
  const raw = song.artist || song.artistName || song.artists || song.ar
  if (Array.isArray(raw)) return raw.map((item) => typeof item === 'string' ? item : item && item.name).filter(Boolean).join(' / ')
  return typeof raw === 'object' && raw ? raw.name || '' : raw || ''
}

function albumData(song) {
  const raw = song.album || song.al
  if (raw && typeof raw === 'object') return { name: raw.name || '', description: raw.description || raw.desc || '' }
  return { name: raw || song.albumName || '', description: song.albumDescription || '' }
}

function extractSongs(payload) {
  return findSongArray(payload).map((song) => {
    const album = albumData(song)
    return {
      id: String(song.id || song.songId || ''),
      title: String(song.title || song.name || ''),
      artist: String(artistName(song)),
      album: String(album.name),
      albumDescription: String(album.description)
    }
  }).filter((song) => song.id && song.title)
}

function extractLyrics(payload) {
  const value = findValue(payload, ['lyrics', 'lyric'])
  return String(value || '')
}

function extractLoginState(payload) {
  const rawStatus = findValue(payload, ['loggedIn', 'isLoggedIn', 'isLogin', 'loginStatus', 'authenticated'])
  const statusText = String(rawStatus == null ? '' : rawStatus).trim().toLowerCase()
  const rawUserId = findValue(payload, ['userId', 'uid'])
  const hasAuthenticatedUser = rawStatus == null && rawUserId != null && String(rawUserId) !== '' && String(rawUserId) !== '0'
  const loggedIn = rawStatus === true || rawStatus === 1 || /^(true|1|logged.?in|已登录|online)$/.test(statusText) || hasAuthenticatedUser
  const state = {
    loggedIn,
    nickname: String(findValue(payload, ['nickname', 'userName', 'username']) || ''),
    qrUrl: String(findValue(payload, ['qrUrl', 'qrCodeUrl', 'url']) || '')
  }
  if (findValue(payload, ['success']) === false) {
    state.error = String(findValue(payload, ['message', 'errorMessage', 'error']) || '网易云 CLI 未能完成登录')
  }
  return state
}

function extractLoginCheckState(payload) {
  const state = extractLoginState(payload)
  return {
    loggedIn: state.loggedIn || findValue(payload, ['success']) === true,
    nickname: state.nickname,
    qrUrl: state.qrUrl
  }
}

function publicLoginError(message) {
  const detail = String(message || '')
  if (/RSA|SHA256|签名|private.?key|app.?id|credential|密钥/i.test(detail)) {
    return '网易云登录失败，请检查 NCM_APP_ID 与 NCM_PRIVATE_KEY'
  }
  return '网易云登录暂时不可用，请稍后再试'
}

async function buildLoginStartState(payload, renderQr) {
  const state = extractLoginState(payload)
  if (state.error) {
    const error = new Error(publicLoginError(state.error))
    error.code = /NCM_APP_ID/.test(error.message) ? 'NCM_CONFIG_INVALID' : 'NCM_LOGIN_FAILED'
    throw error
  }
  if (state.loggedIn) return state
  if (!state.qrUrl) {
    const error = new Error('网易云未返回登录二维码，请检查开放平台配置')
    error.code = 'NCM_QR_MISSING'
    throw error
  }
  return { ...state, qrUrl: await renderQr(state.qrUrl) }
}

function ncmConfigError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function credentialScopedHome(root, appId, privateKey) {
  const fingerprint = crypto.createHash('sha256').update(`${appId}\0${privateKey}`).digest('hex').slice(0, 16)
  return path.join(String(root || '/data/ncm'), `session-${fingerprint}`)
}

function validateRuntimeConfig({ serviceToken, appId, privateKey }) {
  const config = {
    serviceToken: String(serviceToken || '').trim(),
    appId: String(appId || '').trim(),
    privateKey: String(privateKey || '').trim().replace(/\\n/g, '').replace(/\s/g, '')
  }
  const missing = []
  if (!config.serviceToken) missing.push('SERVICE_TOKEN')
  if (!config.appId) missing.push('NCM_APP_ID')
  if (!config.privateKey) missing.push('NCM_PRIVATE_KEY')
  if (missing.length) {
    throw ncmConfigError('NCM_CONFIG_MISSING', `云托管运行实例未收到环境变量：${missing.join('、')}`)
  }
  try {
    crypto.createPrivateKey({ key: Buffer.from(config.privateKey, 'base64'), format: 'der', type: 'pkcs8' })
  } catch (_) {
    throw ncmConfigError('NCM_PRIVATE_KEY_INVALID', '云托管运行实例收到的 NCM_PRIVATE_KEY 不完整或格式无效')
  }
  return config
}

function assertCliConfigured(output, key) {
  const text = String(output && output.output || '')
  if (!text.includes(`已设置 ${key}`)) {
    throw ncmConfigError('NCM_CONFIG_WRITE_FAILED', `网易云 CLI 未能写入 ${key} 配置`)
  }
}

function cliInvocation(packageJsonPath, packageData) {
  const bin = packageData && packageData.bin
  const entry = typeof bin === 'string' ? bin : bin && bin['ncm-cli']
  if (!entry) throw ncmConfigError('NCM_CLI_MISSING', '网易云 CLI 安装包缺少启动入口')
  return {
    command: process.execPath,
    argsPrefix: [path.resolve(path.dirname(packageJsonPath), entry)]
  }
}

module.exports = {
  extractSongs,
  extractLyrics,
  extractLoginState,
  extractLoginCheckState,
  buildLoginStartState,
  publicLoginError,
  credentialScopedHome,
  validateRuntimeConfig,
  assertCliConfigured,
  cliInvocation
}
