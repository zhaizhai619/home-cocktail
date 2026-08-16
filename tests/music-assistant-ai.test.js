const test = require('node:test')
const assert = require('node:assert/strict')

const { createDeepSeekClient, parseJsonContent } = require('../cloudfunctions/musicAssistant/deepseek')
const { selectSongCandidates, selectRelevantNamingFeedback } = require('../cloudfunctions/musicAssistant/matching')
const { SONG_PROFILE_PROMPT_VERSION, COCKTAIL_MATERIAL_GUIDE } = require('../cloudfunctions/musicAssistant/prompts')

test('DeepSeek client requests JSON without copying the API key into payload or errors', async () => {
  let request
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"summary":"夜行"}' } }] }) }
    }
  })
  const result = await client.completeJson({ apiKey: 'secret-key', model: 'deepseek-v4-flash', messages: [{ role: 'user', content: '分析' }] })
  assert.equal(result.summary, '夜行')
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(request.options.headers.Authorization, 'Bearer secret-key')
  assert.equal(request.options.body.includes('secret-key'), false)
  assert.equal(JSON.parse(request.options.body).response_format.type, 'json_object')
  assert.deepEqual(JSON.parse(request.options.body).thinking, { type: 'disabled' })

  const failing = createDeepSeekClient({ fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'secret-key invalid' }) })
  await assert.rejects(() => failing.completeJson({ apiKey: 'secret-key', model: 'deepseek-v4-flash', messages: [] }), /DeepSeek 请求失败（401）/)
  await assert.rejects(() => failing.completeJson({ apiKey: 'secret-key', model: 'deepseek-v4-flash', messages: [] }), (error) => !error.message.includes('secret-key'))
})

test('JSON parser accepts fenced model output', () => {
  assert.deepEqual(parseJsonContent('```json\n{"emotion_keywords":["平静"]}\n```'), { emotion_keywords: ['平静'] })
})

test('candidate ranking uses compact keywords and never forwards stored lyrics', () => {
  const candidates = selectSongCandidates({ emotion_keywords: ['平静'], scene_sensory_keywords: ['绿色', '夏日'] }, [
    { songId: '1', title: 'Summer Night', artist: 'Shark', album: 'Blue Hour', releaseDate: '2024-07-13', preferredTitle: '模型曾经翻译成夏夜', emotion_keywords: ['平静'], scene_sensory_keywords: ['夏日'], lyrics: '不应进入匹配请求' },
    { songId: '2', title: '烈火', emotion_keywords: ['愤怒'], scene_sensory_keywords: ['红色'], lyrics: '不应进入匹配请求' }
  ], 1)
  assert.equal(candidates[0].songId, '1')
  assert.equal(candidates[0].title, 'Summer Night')
  assert.equal(candidates[0].artist, 'Shark')
  assert.equal(candidates[0].album, 'Blue Hour')
  assert.equal(candidates[0].releaseDate, '2024-07-13')
  assert.equal(Object.hasOwn(candidates[0], 'lyrics'), false)
})

test('candidate ranking excludes rejected songs from the current regeneration', () => {
  const profiles = [
    { songId: '1', title: '第一首', emotion_keywords: ['轻松'], scene_sensory_keywords: ['草莓'] },
    { songId: '2', title: '第二首', emotion_keywords: ['轻松'], scene_sensory_keywords: ['气泡'] },
    { songId: '3', title: '第三首', emotion_keywords: ['轻松'], scene_sensory_keywords: ['夏日'] }
  ]
  const candidates = selectSongCandidates(
    { emotion_keywords: ['轻松'], scene_sensory_keywords: ['草莓', '气泡'] },
    profiles,
    2,
    { excludeSongIds: ['1'] }
  )
  assert.deepEqual(candidates.map((item) => item.songId), ['2', '3'])
})

test('vibe mismatch feedback only lowers the same song for a similar cocktail', () => {
  const strawberryCocktail = { emotion_keywords: ['轻松'], scene_sensory_keywords: ['草莓', '气泡'] }
  const profiles = [
    { songId: '1', title: '旧答案', emotion_keywords: ['轻松'], scene_sensory_keywords: ['草莓', '气泡'], fitScore: 9 },
    { songId: '2', title: '新答案', emotion_keywords: ['轻松'], scene_sensory_keywords: ['草莓'], fitScore: 8 }
  ]
  const feedback = [{
    songId: '1', action: 'rejected', tags: ['vibe_mismatch'],
    cocktailProfile: strawberryCocktail,
    createdAt: '2026-08-16T20:00:00.000Z'
  }]
  assert.equal(selectSongCandidates(strawberryCocktail, profiles, 2, { feedback })[0].songId, '2')

  const smokyCocktail = { emotion_keywords: ['沉稳'], scene_sensory_keywords: ['烟熏', '木质'] }
  assert.equal(selectSongCandidates(smokyCocktail, profiles, 2, { feedback })[0].songId, '1')
})

test('feedback retrieval keeps only a few examples relevant to the current cocktail', () => {
  const examples = selectRelevantNamingFeedback(
    { emotion_keywords: ['轻松'], scene_sensory_keywords: ['草莓', '气泡'] },
    [
      { id: 'a', action: 'rejected', tags: ['weak_reason'], cocktailProfile: { emotion_keywords: ['轻松'], scene_sensory_keywords: ['草莓'] } },
      { id: 'b', action: 'used', cocktailProfile: { emotion_keywords: ['轻松'], scene_sensory_keywords: ['气泡'] } },
      { id: 'c', action: 'rejected', tags: ['vibe_mismatch'], cocktailProfile: { emotion_keywords: ['沉稳'], scene_sensory_keywords: ['烟熏'] } }
    ],
    2
  )
  assert.deepEqual(examples.map((item) => item.id), ['a', 'b'])
})

test('prompts expose a version and a concise cocktail material guide', () => {
  assert.match(SONG_PROFILE_PROMPT_VERSION, /^song-profile-v\d+$/)
  assert.match(COCKTAIL_MATERIAL_GUIDE, /金酒/)
  assert.match(COCKTAIL_MATERIAL_GUIDE, /威士忌/)
  assert.ok(COCKTAIL_MATERIAL_GUIDE.length < 1200)
})
