function normalizedKeywords(value) {
  return (Array.isArray(value) ? value : []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
}

function namingScore(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(10, number)) : 0
}

function profileKeywords(profile) {
  return new Set([
    ...normalizedKeywords(profile && profile.emotion_keywords),
    ...normalizedKeywords(profile && profile.scene_sensory_keywords)
  ])
}

function keywordSimilarity(left, right) {
  const a = profileKeywords(left)
  const b = profileKeywords(right)
  if (!a.size || !b.size) return 0
  let overlap = 0
  for (const keyword of a) {
    if (b.has(keyword) || [...b].some((item) => item.includes(keyword) || keyword.includes(item))) overlap += 1
  }
  return overlap / Math.max(1, Math.min(a.size, b.size))
}

function selectRelevantNamingFeedback(cocktailProfile, feedback, limit = 6) {
  return (Array.isArray(feedback) ? feedback : [])
    .map((item, index) => ({ ...item, relevance: keywordSimilarity(cocktailProfile, item && item.cocktailProfile), _index: index }))
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || a._index - b._index)
    .slice(0, Math.max(1, Math.min(12, Number(limit) || 6)))
    .map(({ _index, ...item }) => item)
}

function selectSongCandidates(cocktailProfile, songProfiles, limit = 12, options = {}) {
  const target = new Set([
    ...normalizedKeywords(cocktailProfile && cocktailProfile.emotion_keywords),
    ...normalizedKeywords(cocktailProfile && cocktailProfile.scene_sensory_keywords)
  ])
  const excluded = new Set((Array.isArray(options.excludeSongIds) ? options.excludeSongIds : []).map(String))
  const relevantFeedback = selectRelevantNamingFeedback(cocktailProfile, options.feedback, 50)
  return (Array.isArray(songProfiles) ? songProfiles : []).filter((profile) => !excluded.has(String(profile.songId || profile.song_id || ''))).map((profile) => {
    const keywords = [...normalizedKeywords(profile.emotion_keywords), ...normalizedKeywords(profile.scene_sensory_keywords)]
    const songId = String(profile.songId || profile.song_id || '')
    const baseScore = keywords.reduce((total, keyword) => total + (target.has(keyword) ? 2 : [...target].some((item) => item.includes(keyword) || keyword.includes(item)) ? 1 : 0), 0)
    const contextualPenalty = relevantFeedback.some((item) =>
      item.action === 'rejected' &&
      String(item.songId || '') === songId &&
      Array.isArray(item.tags) && item.tags.includes('vibe_mismatch') &&
      item.relevance >= 0.5
    ) ? 4 : 0
    return {
      songId,
      title: String(profile.title || profile.cleanTitle || ''),
      artist: String(profile.artist || profile.artistName || ''),
      album: String(profile.album || profile.albumName || ''),
      releaseDate: String(profile.releaseDate || profile.release_date || ''),
      summary: String(profile.summary || ''),
      emotion_keywords: normalizedKeywords(profile.emotion_keywords),
      scene_sensory_keywords: normalizedKeywords(profile.scene_sensory_keywords),
      fitScore: namingScore(profile.fitScore || profile.fit_score),
      score: baseScore - contextualPenalty
    }
  }).sort((a, b) => b.score - a.score || b.fitScore - a.fitScore).slice(0, Math.max(1, Number(limit) || 12))
}

module.exports = { keywordSimilarity, selectRelevantNamingFeedback, selectSongCandidates }
