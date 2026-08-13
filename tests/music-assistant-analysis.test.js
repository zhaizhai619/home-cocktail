const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildSongProfileMessages,
  buildCocktailProfileMessages,
  buildNamingMessages,
  normalizeSongProfile,
  normalizeCocktailProfile,
  normalizeRecommendations
} = require('../cloudfunctions/musicAssistant/analysis')

test('song analysis asks for the compact dimensions agreed in the product document', () => {
  const messages = buildSongProfileMessages({
    title: '晴天', artist: '歌手', album: '专辑', albumDescription: '介绍', lyrics: '歌词正文'
  })
  const body = JSON.stringify(messages)
  assert.match(body, /emotion_keywords/)
  assert.match(body, /scene_sensory_keywords/)
  assert.match(body, /preferred_title/)
  assert.doesNotMatch(body, /表层情感|深层情感/)
})

test('profile normalization bounds keyword counts and naming scores', () => {
  const profile = normalizeSongProfile({
    summary: '  一首歌  ',
    emotion_keywords: ['清冷', '克制', '忧伤', '松弛', '多余'],
    scene_sensory_keywords: ['雨夜'],
    naming: { preferred_title: '夜航', fit_score: 120, risks: ['太长'] },
    analysis_confidence: -2
  })
  assert.deepEqual(profile.emotion_keywords, ['清冷', '克制', '忧伤', '松弛'])
  assert.equal(profile.naming.fit_score, 100)
  assert.equal(profile.analysis_confidence, 0)
})

test('cocktail and naming prompts use ingredients but send only compact song profiles', () => {
  const cocktailMessages = buildCocktailProfileMessages({
    color: '青绿色', preference: '想要中文名', ingredients: [{ name: '金酒', amount: 45, unit: 'ml' }]
  })
  assert.match(JSON.stringify(cocktailMessages), /金酒/)

  const profile = normalizeCocktailProfile({
    summary: '清爽草本', emotion_keywords: ['清冷'], scene_sensory_keywords: ['夏夜'],
    naming_direction: { desired: ['简短'], avoid: ['俗气'] }
  })
  const namingMessages = buildNamingMessages({ cocktail: profile, candidates: [{ songId: '1', title: '夜航', lyrics: '不应发送的完整歌词' }] })
  assert.doesNotMatch(JSON.stringify(namingMessages), /不应发送的完整歌词/)

  assert.deepEqual(normalizeRecommendations({ recommendations: [{ song_id: '1', recommended_name: ' 夜航 ', reason: ' 很适合 ' }] }), [
    { song_id: '1', recommended_name: '夜航', reason: '很适合' }
  ])
})
