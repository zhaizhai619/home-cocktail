function createNcmClient({ baseUrl, token, fetchImpl = global.fetch } = {}) {
  const root = String(baseUrl || '').trim().replace(/\/$/, '')
  const serviceToken = String(token || '').trim()
  if (!root || !serviceToken || typeof fetchImpl !== 'function') {
    const unavailable = async () => { throw new Error('网易云音乐服务尚未配置') }
    return { listLikedSongs: unavailable, getSongSource: unavailable, startLogin: unavailable, loginStatus: unavailable }
  }

  async function request(path, options = {}) {
    const response = await fetchImpl(`${root}${path}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceToken}` },
      body: options.body ? JSON.stringify(options.body) : undefined
    })
    let payload = null
    try { payload = await response.json() } catch (_) {}
    const backendMessage = payload && payload.error && typeof payload.error === 'object'
      ? payload.error.message
      : ''
    if (!response.ok) throw new Error(backendMessage || `网易云音乐服务请求失败（${response.status || '未知状态'}）`)
    if (!payload || payload.ok === false) throw new Error(backendMessage || '网易云音乐服务暂时不可用')
    return payload.data || payload
  }

  return {
    async listLikedSongs(limit) {
      const data = await request(`/library/liked?limit=${Math.max(1, Math.min(300, Number(limit) || 20))}`)
      return (Array.isArray(data.songs) ? data.songs : []).map((song) => ({
        id: String(song.id || song.songId || ''),
        encryptedId: String(song.encryptedId || ''),
        title: String(song.title || song.name || ''),
        artist: String(song.artist || song.artistName || ''),
        album: String(song.album || song.albumName || ''),
        albumDescription: String(song.albumDescription || ''),
        releaseDate: String(song.releaseDate || '')
      })).filter((song) => song.id)
    },
    async getSongSource(songId, metadata = {}) {
      const requestId = String(songId)
      const data = await request(`/songs/${encodeURIComponent(requestId)}/lyrics`)
      return { ...metadata, id: String(songId), lyrics: String(data.lyrics || data.lyric || '') }
    },
    startLogin() { return request('/auth/start', { method: 'POST' }) },
    loginStatus() { return request('/auth/status') }
  }
}

module.exports = { createNcmClient }
