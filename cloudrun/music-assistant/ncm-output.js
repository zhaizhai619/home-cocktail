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
  const rawStatus = findValue(payload, ['loggedIn', 'isLogin', 'loginStatus', 'authenticated'])
  const statusText = String(rawStatus == null ? '' : rawStatus).trim().toLowerCase()
  const loggedIn = rawStatus === true || rawStatus === 1 || /^(true|1|logged.?in|已登录|online)$/.test(statusText)
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

module.exports = { extractSongs, extractLyrics, extractLoginState, buildLoginStartState, publicLoginError }
