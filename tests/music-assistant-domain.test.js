const test = require('node:test')
const assert = require('node:assert/strict')

const {
  cleanSongTitle,
  buildAnalysisIdentity,
  createAnalysisJob,
  applySongResult
} = require('../cloudfunctions/musicAssistant/domain')

test('song title cleaning removes only supported terminal version markers', () => {
  assert.equal(cleanSongTitle('夜色（Live）'), '夜色')
  assert.equal(cleanSongTitle('Night Drive (Remix)'), 'Night Drive')
  assert.equal(cleanSongTitle('回声 (prod. Aster)'), '回声')
  assert.equal(cleanSongTitle('故事（上）'), '故事（上）')
})

test('analysis identity reuses identical work and changes with source model or prompt', () => {
  const song = { id: '42', title: '夜色（Live）', artist: '甲', album: '城', lyrics: '凌晨的街道' }
  const first = buildAnalysisIdentity({ song, model: 'deepseek-v4-flash', promptVersion: 'song-profile-v1', modelParams: { temperature: 0.2 } })
  const same = buildAnalysisIdentity({ song: { ...song }, model: 'deepseek-v4-flash', promptVersion: 'song-profile-v1', modelParams: { temperature: 0.2 } })
  const changedModel = buildAnalysisIdentity({ song, model: 'deepseek-v4-pro', promptVersion: 'song-profile-v1', modelParams: { temperature: 0.2 } })
  const changedLyrics = buildAnalysisIdentity({ song: { ...song, lyrics: '清晨的街道' }, model: 'deepseek-v4-flash', promptVersion: 'song-profile-v1', modelParams: { temperature: 0.2 } })
  assert.equal(first.cacheKey, same.cacheKey)
  assert.notEqual(first.cacheKey, changedModel.cacheKey)
  assert.notEqual(first.cacheKey, changedLyrics.cacheKey)

  const longLyrics = buildAnalysisIdentity({ song: { ...song, lyrics: '甲'.repeat(700) }, model: 'deepseek-v4-flash', promptVersion: 'song-profile-v1', modelParams: { temperature: 0.2 } })
  assert.equal(longLyrics.source.lyrics.length, 600)
})

test('analysis jobs persist progress without persisting the DeepSeek key', () => {
  const job = createAnalysisJob({
    id: 'job-1',
    songs: [{ id: '1' }, { id: '2' }],
    limit: 2,
    model: 'deepseek-v4-flash',
    apiKey: 'must-not-be-saved',
    now: '2026-08-03T00:00:00.000Z'
  })
  assert.equal(JSON.stringify(job).includes('must-not-be-saved'), false)
  assert.deepEqual(job.progress, { total: 2, completed: 0, failed: 0, skipped: 0 })

  const completed = applySongResult(job, { songId: '1', status: 'completed' }, '2026-08-03T00:01:00.000Z')
  const finished = applySongResult(completed, { songId: '2', status: 'cached' }, '2026-08-03T00:02:00.000Z')
  assert.deepEqual(finished.progress, { total: 2, completed: 1, failed: 0, skipped: 1 })
  assert.equal(finished.status, 'completed')
})
