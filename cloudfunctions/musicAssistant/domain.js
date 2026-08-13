const crypto = require('crypto')

function cleanText(value) {
  return String(value || '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
}

function cleanSongTitle(value) {
  const title = String(value || '').trim()
  const match = title.match(/^(.*?)\s*[（(]([^（）()]*)[）)]\s*$/)
  if (!match) return title
  const marker = match[2].trim()
  return /(^|\b)(live|remix)(\b|$)/i.test(marker) || /^prod\.?\s+.+/i.test(marker) ? match[1].trim() : title
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stable(value[key])
    return result
  }, {})
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}

function normalizeSongSource(song = {}) {
  return {
    id: String(song.id || song.songId || ''),
    encryptedId: String(song.encryptedId || ''),
    title: cleanSongTitle(song.title || song.name),
    artist: cleanText(song.artist || song.artistName),
    album: cleanText(song.album || song.albumName),
    albumDescription: cleanText(song.albumDescription).slice(0, 800),
    lyrics: cleanText(song.lyrics).slice(0, 600)
  }
}

function buildAnalysisIdentity({ song, model, promptVersion, modelParams } = {}) {
  const source = normalizeSongSource(song)
  const sourceFingerprint = digest(source)
  const analysisVersion = digest({ model: String(model || ''), promptVersion: String(promptVersion || ''), modelParams: stable(modelParams || {}) })
  return {
    source,
    sourceFingerprint,
    analysisVersion,
    cacheKey: `${source.id}:${sourceFingerprint}:${analysisVersion}`
  }
}

function createAnalysisJob({ id, songs, limit, model, now } = {}) {
  const supplied = Array.isArray(songs) ? songs : []
  const requested = Math.max(1, Number.parseInt(limit, 10) || supplied.length || 1)
  const selected = supplied.slice(0, requested).map(normalizeSongSource).filter((song) => song.id)
  const songsById = selected.reduce((result, song) => {
    if (!result[song.id]) result[song.id] = { ...song, lyrics: '' }
    return result
  }, {})
  const songIds = Object.keys(songsById)
  const timestamp = String(now || new Date().toISOString())
  return {
    id: String(id || ''),
    status: songIds.length ? 'queued' : 'completed',
    model: String(model || ''),
    songIds,
    songs: songsById,
    results: {},
    progress: { total: songIds.length, completed: 0, failed: 0, skipped: 0 },
    currentSongId: '',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function applySongResult(job, result, now) {
  const source = job && typeof job === 'object' ? job : createAnalysisJob()
  const songId = String(result && result.songId || '')
  if (!songId || !source.songIds.includes(songId)) return source
  const status = ['completed', 'cached', 'failed'].includes(result.status) ? result.status : 'failed'
  const results = { ...(source.results || {}), [songId]: { status, error: status === 'failed' ? String(result.error || '解析失败') : '' } }
  const values = Object.values(results)
  const progress = {
    total: source.songIds.length,
    completed: values.filter((item) => item.status === 'completed').length,
    failed: values.filter((item) => item.status === 'failed').length,
    skipped: values.filter((item) => item.status === 'cached').length
  }
  const processed = progress.completed + progress.failed + progress.skipped
  return {
    ...source,
    results,
    progress,
    currentSongId: processed >= progress.total ? '' : source.songIds.find((id) => !results[id]) || '',
    status: processed >= progress.total ? 'completed' : 'running',
    updatedAt: String(now || new Date().toISOString())
  }
}

module.exports = {
  cleanSongTitle,
  normalizeSongSource,
  buildAnalysisIdentity,
  createAnalysisJob,
  applySongResult
}
