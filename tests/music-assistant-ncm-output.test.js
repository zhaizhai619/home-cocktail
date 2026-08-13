const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')

const {
  extractSongs,
  extractLyrics,
  extractLoginState,
  buildLoginStartState,
  credentialScopedHome,
  validateRuntimeConfig,
  assertCliConfigured,
  cliInvocation
} = require('../cloudrun/music-assistant/ncm-output')

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

test('CLI home is isolated by a stable non-secret credential fingerprint', () => {
  const expectedFingerprint = crypto.createHash('sha256').update('app-a\0key-a').digest('hex').slice(0, 16)
  assert.equal(
    credentialScopedHome && credentialScopedHome('/data/ncm', 'app-a', 'key-a'),
    path.join('/data/ncm', `session-${expectedFingerprint}`)
  )
  assert.equal(
    credentialScopedHome && credentialScopedHome('/data/ncm', 'app-a', 'key-a'),
    credentialScopedHome && credentialScopedHome('/data/ncm', 'app-a', 'key-a')
  )
  assert.notEqual(
    credentialScopedHome && credentialScopedHome('/data/ncm', 'app-a', 'key-a'),
    credentialScopedHome && credentialScopedHome('/data/ncm', 'app-a', 'key-b')
  )
})

test('runtime config identifies missing variables instead of blaming valid credentials', () => {
  assert.throws(
    () => validateRuntimeConfig && validateRuntimeConfig({ serviceToken: 'token', appId: '', privateKey: '' }),
    /运行实例未收到环境变量：NCM_APP_ID、NCM_PRIVATE_KEY/
  )
})

test('runtime config accepts a complete PKCS8 private key', () => {
  const privateKey = crypto.generateKeyPairSync('rsa', { modulusLength: 512 }).privateKey
    .export({ type: 'pkcs8', format: 'der' }).toString('base64')
  assert.deepEqual(
    validateRuntimeConfig && validateRuntimeConfig({ serviceToken: 'token', appId: 'app-id', privateKey }),
    { serviceToken: 'token', appId: 'app-id', privateKey }
  )
})

test('CLI config output must confirm that the requested value was written', () => {
  assert.doesNotThrow(() => assertCliConfigured && assertCliConfigured({ output: '✓ 已设置 appId = abc' }, 'appId'))
  assert.throws(
    () => assertCliConfigured && assertCliConfigured({ output: '配置写入失败' }, 'privateKey'),
    /网易云 CLI 未能写入 privateKey 配置/
  )
})

test('cloud service invokes the installed CLI with the current Node executable', () => {
  const packageJsonPath = '/app/node_modules/@music163/ncm-cli/package.json'
  assert.deepEqual(
    cliInvocation && cliInvocation(packageJsonPath, { bin: { 'ncm-cli': 'dist/index.js' } }),
    {
      command: process.execPath,
      argsPrefix: ['/app/node_modules/@music163/ncm-cli/dist/index.js']
    }
  )
})
