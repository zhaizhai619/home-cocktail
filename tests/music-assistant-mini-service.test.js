const test = require('node:test')
const assert = require('node:assert/strict')

const { createMusicAssistantClient, createMusicAssistantSettings } = require('../miniprogram/services/music-assistant')

test('mini-program music client calls only the dedicated cloud function', async () => {
  const calls = []
  const client = createMusicAssistantClient({ callFunction: async (request) => { calls.push(request); return { result: { ok: true, data: { job: null } } } } })
  assert.deepEqual(await client.getStatus(), { job: null })
  await client.processNext({ jobId: 'j1', apiKey: 'local-key', model: 'deepseek-v4-flash' })
  await client.submitNamingFeedback({ songId: 'song-1', feedbackAction: 'rejected', tags: ['vibe_mismatch'] })
  assert.equal(calls[0].name, 'musicAssistant')
  assert.equal(calls[1].data.apiKey, 'local-key')
  assert.deepEqual(calls[2].data, { action: 'submitNamingFeedback', songId: 'song-1', feedbackAction: 'rejected', tags: ['vibe_mismatch'] })
})

test('DeepSeek settings stay in device storage and normalize the import count', () => {
  const memory = {}
  const settings = createMusicAssistantSettings({
    getStorageSync(key) { return memory[key] },
    setStorageSync(key, value) { memory[key] = value }
  })
  settings.save({ apiKey: ' secret ', model: 'deepseek-v4-flash', importCount: 999 })
  assert.deepEqual(settings.load(), { apiKey: 'secret', model: 'deepseek-v4-flash', importCount: 300 })
})
