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

function namingScore(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(10, number)) : 0
}

function jsonMessages(system, payload) {
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(payload) }
  ]
}

function buildSongProfileMessages(song = {}) {
  return jsonMessages(
    `你是懂中文说唱语境的歌曲编辑。任务是从输入资料中提取可复核的歌曲画像，并单独评价歌名作为鸡尾酒名字的适用性。

分析规则：
1. 只使用输入中明确提供的 title、artist、album、album_description 和 lyrics，不补写歌词、歌曲背景、流行度或创作事实。
2. summary 用一句简洁中文概括歌曲主要表达。
3. emotion_keywords 提取 0 至 4 个主要情绪或表达态度，合并近义词，不把人物、主题或场景当成情绪。
4. scene_sensory_keywords 提取 0 至 4 个有明确文字依据的场景或感官意象，例如时间、空间、自然物、城市元素、颜色、温度、质感和动作；没有明确依据时输出空数组，不要为了凑数量而推测。
5. fit_score 只评价 title 这段文字单独作为鸡尾酒名字是否合适，与歌词、音乐内容、歌曲情绪、歌手、专辑、语言和热度无关。评分为 0 至 10，可使用一位小数，不要默认给高分：0-2 明显不适合；3-4 生硬或缺乏命名感；5-6 普通可用；7-8 自然、易记且有画面；9-10 独特、自然、有情调。
6. risks 只记录歌名本身可能影响鸡尾酒命名的问题，最多 3 个；没有则输出空数组。

输出纯 JSON：{"summary":"一句话主题","emotion_keywords":[],"scene_sensory_keywords":[],"naming":{"fit_score":0,"risks":[]}}。${SONG_PROFILE_PROMPT_VERSION}`,
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
      fit_score: namingScore(naming.fit_score),
      risks: keywords(naming.risks, 3)
    }
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
    artist: text(candidate.artist, 160),
    release_date: text(candidate.releaseDate || candidate.release_date, 10),
    summary: text(candidate.summary, 240),
    emotion_keywords: keywords(candidate.emotion_keywords),
    scene_sensory_keywords: keywords(candidate.scene_sensory_keywords),
    fit_score: namingScore(candidate.fitScore || candidate.fit_score)
  }
}

function buildNamingMessages({ cocktail, candidates } = {}) {
  return jsonMessages(
    `你是鸡尾酒命名编辑。只能从候选歌曲的 title 中选择名称，不得杜撰歌曲。

每条 reason 都必须同时做到：
1. 自然写出候选的 artist（歌手），并准确吸收 summary 中至少一个核心意思，让熟悉说唱的读者能确认具体是哪首歌；不要只是复述歌名。
2. 完整保留并充分展开歌曲与鸡尾酒的匹配分析，结合鸡尾酒气质、材料及用量、颜色或用户偏好，不能因为增加歌曲介绍而缩短或弱化原有分析。
3. 不写专辑名。发行日期仅在确实属于近期发布且有介绍价值时才可自然提及。

表达必须自然且多样：可以从歌手的表达、歌曲主题、歌词态度或酒的感官特点切入，灵活调整先后顺序；多条推荐不要使用相同开头，避免固定使用“这是某某的《某歌》”之类的模板句式。只能使用输入中明确提供的事实，不得编造发行时间、热度、播放量或歌曲经历。每条理由写成一段连贯自然的中文。

返回最多3项纯 JSON：{"recommendations":[{"song_id":"候选ID","recommended_name":"最终酒名","reason":"包含歌手、歌曲表达和完整酒品匹配分析的自然理由"}]}。${NAMING_PROMPT_VERSION}`,
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
