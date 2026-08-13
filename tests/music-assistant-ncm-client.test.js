const test = require('node:test')
const assert = require('node:assert/strict')

const { createNcmClient } = require('../cloudfunctions/musicAssistant/ncm-client')

test('NCM proxy client uses the private service token only in its header', async () => {
  const requests = []
  const client = createNcmClient({
    baseUrl: 'https://music.example.test/',
    token: 'private-service-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return { ok: true, json: async () => ({ ok: true, data: { songs: [{ id: 1, name: '夜航' }] } }) }
    }
  })
  const songs = await client.listLikedSongs(18)
  assert.equal(songs[0].title, '夜航')
  assert.equal(requests[0].url, 'https://music.example.test/library/liked?limit=18')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-service-token')
  assert.doesNotMatch(requests[0].url, /private-service-token/)
})

test('NCM proxy client merges lyrics into the supplied song metadata', async () => {
  const client = createNcmClient({
    baseUrl: 'https://music.example.test', token: 'token',
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, data: { lyrics: '凌晨的街道' } }) })
  })
  assert.deepEqual(await client.getSongSource('42', { title: '夜航' }), { id: '42', title: '夜航', lyrics: '凌晨的街道' })
})
