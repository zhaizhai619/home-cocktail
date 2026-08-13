const {
  SONG_PROFILE_PROMPT_VERSION,
  COCKTAIL_PROFILE_PROMPT_VERSION,
  NAMING_PROMPT_VERSION,
  COCKTAIL_MATERIAL_GUIDE
} = require('./prompts')

function text(value, maxLength = 1200) {
  return String(value || '').trim().slice(0, maxLength)
}

function keywords(value, max = 4) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => text(item, 24)).filter(Boolean))].slice(0, max)
}

function score(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0
}

function jsonMessages(system, payload) {
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(payload) }
  ]
}

function buildSongProfileMessages(song = {}) {
  return jsonMessages(
    `你是懂中文说唱语境的歌曲编辑。只根据提供的信息分析，不补写歌词事实。输出纯 JSON：{"summary":"一句话主题","emotion_keywords":["2至4个情绪词"],"scene_sensory_keywords":["2至4个场景或感官词"],"naming":{"preferred_title":"必须原样复制输入title，不翻译不改写","fit_score":0,"risks":["可能影响酒名使用的问题"]},"analysis_confidence":0}。分数均为0至100。${SONG_PROFILE_PROMPT_VERSION}`,
    {
      title: text(song.title, 120),
      artist: text(song.artist, 160),
      album: text(song.album, 160),
      album_description: text(song.albumDescription, 800),
      lyrics: text(song.lyrics, 600)
    }
  )
}

function normalizeSongProfile(value = {}) {
  const naming = value.naming && typeof value.naming === 'object' ? value.naming : {}
  return {
    summary: text(value.summary, 240),
    emotion_keywords: keywords(value.emotion_keywords),
    scene_sensory_keywords: keywords(value.scene_sensory_keywords),
    naming: {
      preferred_title: text(naming.preferred_title, 120),
      fit_score: score(naming.fit_score),
      risks: keywords(naming.risks, 3)
    },
    analysis_confidence: score(value.analysis_confidence)
  }
}

function buildCocktailProfileMessages(cocktail = {}) {
  return jsonMessages(
    `你是鸡尾酒命名编辑。材料和用量用于判断主次，用户填写的颜色和偏好优先。${COCKTAIL_MATERIAL_GUIDE}\n输出纯 JSON：{"summary":"一句话气质","emotion_keywords":["2至4个"],"scene_sensory_keywords":["2至4个"],"naming_direction":{"desired":["希望的命名方向"],"avoid":["应避免的方向"]}}。${COCKTAIL_PROFILE_PROMPT_VERSION}`,
    {
      color: text(cocktail.color, 80),
      preference: text(cocktail.preference, 240),
      ingredients: (Array.isArray(cocktail.ingredients) ? cocktail.ingredients : []).slice(0, 30).map((item) => ({
        name: text(item && (item.name || item.materialName), 80),
        amount: Number(item && item.amount) || 0,
        unit: text(item && item.unit, 20)
      }))
    }
  )
}

function normalizeCocktailProfile(value = {}) {
  const direction = value.naming_direction && typeof value.naming_direction === 'object' ? value.naming_direction : {}
  return {
    summary: text(value.summary, 240),
    emotion_keywords: keywords(value.emotion_keywords),
    scene_sensory_keywords: keywords(value.scene_sensory_keywords),
    naming_direction: { desired: keywords(direction.desired, 4), avoid: keywords(direction.avoid, 4) }
  }
}

function compactCandidate(candidate = {}) {
  return {
    song_id: text(candidate.songId || candidate.song_id, 80),
    title: text(candidate.title, 120),
    summary: text(candidate.summary, 240),
    emotion_keywords: keywords(candidate.emotion_keywords),
    scene_sensory_keywords: keywords(candidate.scene_sensory_keywords),
    fit_score: score(candidate.fitScore || candidate.fit_score)
  }
}

function buildNamingMessages({ cocktail, candidates } = {}) {
  return jsonMessages(
    `你是鸡尾酒命名编辑。只能从候选歌曲的 title 中选择名称，不得杜撰歌曲。结合鸡尾酒气质、用户偏好和歌曲含义，返回最多3项纯 JSON：{"recommendations":[{"song_id":"候选ID","recommended_name":"最终酒名","reason":"一段简洁自然的中文理由"}]}。${NAMING_PROMPT_VERSION}`,
    { cocktail: normalizeCocktailProfile(cocktail), candidates: (Array.isArray(candidates) ? candidates : []).slice(0, 12).map(compactCandidate) }
  )
}

function normalizeRecommendations(value = {}) {
  return (Array.isArray(value.recommendations) ? value.recommendations : []).slice(0, 3).map((item) => ({
    song_id: text(item && item.song_id, 80),
    recommended_name: text(item && item.recommended_name, 120),
    reason: text(item && item.reason, 360)
  })).filter((item) => item.song_id && item.recommended_name && item.reason)
}

module.exports = {
  buildSongProfileMessages,
  buildCocktailProfileMessages,
  buildNamingMessages,
  normalizeSongProfile,
  normalizeCocktailProfile,
  normalizeRecommendations
}
