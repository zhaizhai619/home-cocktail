const test = require('node:test')
const assert = require('node:assert/strict')

const { extractSongs, extractLyrics, extractLoginState } = require('../cloudrun/music-assistant/ncm-output')

test('CLI output normalization accepts common nested song and lyric shapes', () => {
  assert.deepEqual(extractSongs({ data: { songs: [{ id: 1, name: '夜航', artists: [{ name: '甲' }], album: { name: '城' } }] } }), [
    { id: '1', title: '夜航', artist: '甲', album: '城', albumDescription: '' }
  ])
  assert.equal(extractLyrics({ data: { lrc: { lyric: '凌晨的街道' } } }), '凌晨的街道')
})

test('login output exposes a small safe status object', () => {
  assert.deepEqual(extractLoginState({ data: { loggedIn: true, nickname: '阿孟', qrUrl: 'https://example.test/qr' } }), {
    loggedIn: true, nickname: '阿孟', qrUrl: 'https://example.test/qr'
  })
  assert.equal(extractLoginState({ loginStatus: '未登录' }).loggedIn, false)
})
