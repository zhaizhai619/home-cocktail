function normalizedKeywords(value) {
  return (Array.isArray(value) ? value : []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
}

function namingScore(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(10, number)) : 0
}

function selectSongCandidates(cocktailProfile, songProfiles, limit = 12) {
  const target = new Set([
    ...normalizedKeywords(cocktailProfile && cocktailProfile.emotion_keywords),
    ...normalizedKeywords(cocktailProfile && cocktailProfile.scene_sensory_keywords)
  ])
  return (Array.isArray(songProfiles) ? songProfiles : []).map((profile) => {
    const keywords = [...normalizedKeywords(profile.emotion_keywords), ...normalizedKeywords(profile.scene_sensory_keywords)]
    const score = keywords.reduce((total, keyword) => total + (target.has(keyword) ? 2 : [...target].some((item) => item.includes(keyword) || keyword.includes(item)) ? 1 : 0), 0)
    return {
      songId: String(profile.songId || profile.song_id || ''),
      title: String(profile.title || profile.cleanTitle || ''),
      artist: String(profile.artist || profile.artistName || ''),
      album: String(profile.album || profile.albumName || ''),
      releaseDate: String(profile.releaseDate || profile.release_date || ''),
      summary: String(profile.summary || ''),
      emotion_keywords: normalizedKeywords(profile.emotion_keywords),
      scene_sensory_keywords: normalizedKeywords(profile.scene_sensory_keywords),
      fitScore: namingScore(profile.fitScore || profile.fit_score),
      score
    }
  }).sort((a, b) => b.score - a.score || b.fitScore - a.fitScore).slice(0, Math.max(1, Number(limit) || 12))
}

module.exports = { selectSongCandidates }
