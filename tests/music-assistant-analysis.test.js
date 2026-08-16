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
  assert.doesNotMatch(body, /preferred_title/)
  assert.match(body, /0\s*至\s*10|0-10/)
  assert.match(body, /只评价.*歌名|只根据.*title/)
  assert.match(body, /fit_score.*与歌词.*音乐内容.*无关/)
  assert.match(body, /证据不足.*空数组|没有明确依据.*空数组/)
  assert.doesNotMatch(body, /analysis_confidence/)
  assert.doesNotMatch(body, /表层情感|深层情感/)
})

test('profile normalization bounds naming scores to ten and drops analysis confidence', () => {
  const profile = normalizeSongProfile({
    summary: '  一首歌  ',
    emotion_keywords: ['清冷', '克制', '忧伤', '松弛', '多余'],
    scene_sensory_keywords: ['雨夜'],
    naming: { preferred_title: '不应保留', fit_score: 120, risks: ['太长'] },
    analysis_confidence: -2
  })
  assert.deepEqual(profile.emotion_keywords, ['清冷', '克制', '忧伤', '松弛'])
  assert.equal(profile.naming.fit_score, 10)
  assert.equal(Object.hasOwn(profile.naming, 'preferred_title'), false)
  assert.equal(Object.hasOwn(profile, 'analysis_confidence'), false)
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
  const namingMessages = buildNamingMessages({ cocktail: profile, candidates: [{
    songId: '1', title: '夜航', artist: '甲', album: '城市', releaseDate: '2024-07-13', fitScore: 88,
    summary: '在夜路中保持清醒和克制',
    lyrics: '不应发送的完整歌词'
  }] })
  const namingBody = JSON.stringify(namingMessages)
  assert.doesNotMatch(namingBody, /不应发送的完整歌词/)
  assert.match(namingBody, /甲/)
  assert.doesNotMatch(namingBody, /城市/)
  assert.match(namingBody, /2024-07-13/)
  assert.match(namingBody, /每条[\s\S]*歌手/)
  assert.match(namingBody, /每条[\s\S]*summary/)
  assert.match(namingBody, /保留|完整/)
  assert.match(namingBody, /多样|避免固定|不要使用固定/)
  assert.doesNotMatch(namingBody, /不是每条理由都必须写|不必每条都写/)
  assert.match(namingBody, /不得编造/)
  assert.equal(JSON.parse(namingMessages[1].content).candidates[0].fit_score, 10)

  assert.deepEqual(normalizeRecommendations({ recommendations: [{ song_id: '1', recommended_name: ' 夜航 ', reason: ' 很适合 ' }] }), [
    { song_id: '1', recommended_name: '夜航', reason: '很适合' }
  ])
})
