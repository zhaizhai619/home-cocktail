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
  return {
    loggedIn,
    nickname: String(findValue(payload, ['nickname', 'userName', 'username']) || ''),
    qrUrl: String(findValue(payload, ['qrUrl', 'qrCodeUrl', 'url']) || '')
  }
}

module.exports = { extractSongs, extractLyrics, extractLoginState }
