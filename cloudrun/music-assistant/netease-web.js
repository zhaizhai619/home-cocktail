const NETEASE_ROOT = 'https://music.163.com'
const REQUEST_HEADERS = { Referer: `${NETEASE_ROOT}/`, 'User-Agent': 'Mozilla/5.0' }

const CREDIT_LINE = /^(?:作词|作曲|词|曲|编曲|制作人|监制|混音|母带(?:处理)?|录音|和声(?:编写)?|配唱制作人|人声编辑|音频编辑|吉他|贝斯|鼓|弦乐|出品|发行|企划|统筹|OP|SP|Lyrics?|Composer|Arranger|Producer|Mixed?\s+by|Mastered?\s+by)\s*[:：]\s*\S+/i

function cleanNeteaseLyrics(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\[[^\]]*\]\s*)+/, '').trim())
    .filter((line) => line && !CREDIT_LINE.test(line))
    .join('\n')
}

async function requestJson(url, fetchImpl) {
  const options = { headers: REQUEST_HEADERS }
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') options.signal = AbortSignal.timeout(15000)
  const response = await fetchImpl(url, options)
  let payload = null
  try { payload = await response.json() } catch (_) {}
  if (!response.ok || !payload || Number(payload.code) !== 200) throw new Error(`网易云公开接口请求失败（${response.status || '未知状态'}）`)
  return payload
}

async function fetchNeteaseLyrics(songId, fetchImpl = global.fetch) {
  const id = String(songId || '')
  if (!/^\d+$/.test(id) || typeof fetchImpl !== 'function') throw new Error('无效的网易云歌曲 ID')
  const url = `${NETEASE_ROOT}/api/song/lyric?id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`
  const payload = await requestJson(url, fetchImpl)
  return cleanNeteaseLyrics(payload && payload.lrc && payload.lrc.lyric)
}

function songData(song) {
  const artists = song && (song.artists || song.ar)
  const album = song && (song.album || song.al)
  return {
    id: String(song && song.id || ''),
    title: String(song && (song.name || song.title) || ''),
    artist: (Array.isArray(artists) ? artists : []).map((item) => item && item.name).filter(Boolean).join(' / '),
    album: String(album && album.name || ''),
    albumDescription: String(album && (album.description || album.desc) || '')
  }
}

async function fetchLikedPlaylistSongs(playlistId, limit, fetchImpl = global.fetch) {
  const id = String(playlistId || '')
  const requested = Math.max(1, Math.min(300, Number.parseInt(limit, 10) || 20))
  if (!/^\d+$/.test(id) || typeof fetchImpl !== 'function') throw new Error('无效的网易云歌单 ID')
  const playlistUrl = `${NETEASE_ROOT}/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=100000&s=8`
  const playlistPayload = await requestJson(playlistUrl, fetchImpl)
  const trackIds = Array.isArray(playlistPayload && playlistPayload.playlist && playlistPayload.playlist.trackIds)
    ? playlistPayload.playlist.trackIds.map((item) => String(item && item.id || '')).filter((value) => /^\d+$/.test(value))
    : []
  const selectedIds = [...new Set(trackIds)].slice(0, requested)
  const byId = new Map()
  for (let index = 0; index < selectedIds.length; index += 100) {
    const batch = selectedIds.slice(index, index + 100)
    const detailUrl = `${NETEASE_ROOT}/api/song/detail?ids=${encodeURIComponent(JSON.stringify(batch))}`
    const detailPayload = await requestJson(detailUrl, fetchImpl)
    for (const rawSong of Array.isArray(detailPayload.songs) ? detailPayload.songs : []) {
      const song = songData(rawSong)
      if (song.id && song.title) byId.set(song.id, song)
    }
  }
  return selectedIds.map((songId) => byId.get(songId)).filter(Boolean)
}

module.exports = { cleanNeteaseLyrics, fetchNeteaseLyrics, fetchLikedPlaylistSongs }
