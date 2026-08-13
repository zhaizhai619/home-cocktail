const test = require('node:test')
const assert = require('node:assert/strict')

const { extractSongs, extractLyrics, extractLoginState, buildLoginStartState } = require('../cloudrun/music-assistant/ncm-output')

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

test('login output preserves CLI failures so they cannot become an empty QR state', () => {
  assert.deepEqual(extractLoginState({ success: false, message: 'RSA SHA256 签名失败' }), {
    loggedIn: false,
    nickname: '',
    qrUrl: '',
    error: 'RSA SHA256 签名失败'
  })
})

test('login start converts CLI QR content into a displayable image data URL', async () => {
  const rendered = []
  const state = await buildLoginStartState(
    { success: true, qrCodeUrl: 'https://music.163.com/login?code=abc' },
    async (content) => {
      rendered.push(content)
      return 'data:image/png;base64,qr-image'
    }
  )
  assert.deepEqual(rendered, ['https://music.163.com/login?code=abc'])
  assert.deepEqual(state, {
    loggedIn: false,
    nickname: '',
    qrUrl: 'data:image/png;base64,qr-image'
  })
})

test('login start reports an actionable safe error for invalid NCM credentials', async () => {
  await assert.rejects(
    buildLoginStartState({ success: false, message: 'RSA SHA256 签名失败: private key unsupported' }, async () => ''),
    /请检查 NCM_APP_ID 与 NCM_PRIVATE_KEY/
  )
})
