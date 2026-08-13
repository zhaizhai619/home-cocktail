const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')

const {
  extractSongs,
  extractLyrics,
  extractLoginState,
  extractLoginCheckState,
  extractPlaylistIdentifier,
  summarizePayloadStructure,
  validSongIdentifier,
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

test('red-heart songs use the CLI originalId as their stable song id', () => {
  assert.deepEqual(extractSongs({
    success: true,
    data: {
      songs: [{
        originalId: 2049913337,
        encryptedId: 'encrypted-song-id',
        name: '夜航',
        artists: [{ name: '甲' }],
        album: { name: '城', description: '专辑介绍' },
        extMap: { addTime: 1720000000000 },
        songTag: ['Hip-Hop']
      }]
    }
  }), [
    {
      id: '2049913337',
      encryptedId: 'encrypted-song-id',
      title: '夜航',
      artist: '甲',
      album: '城',
      albumDescription: '专辑介绍'
    }
  ])
})

test('red-heart songs are discovered inside CLI resource wrappers', () => {
  assert.deepEqual(extractSongs({
    code: 200,
    data: {
      list: [{
        resource: {
          originalId: 2049913337,
          encryptedId: '0123456789abcdef0123456789abcdef',
          name: '夜航',
          artists: [{ name: '甲' }],
          album: { name: '城' }
        }
      }]
    }
  }), [{
    id: '2049913337',
    encryptedId: '0123456789abcdef0123456789abcdef',
    title: '夜航',
    artist: '甲',
    album: '城',
    albumDescription: ''
  }])
})

test('a favorite playlist is not normalized as a song', () => {
  const favorite = {
    code: 200,
    data: {
      resource: {
        originalId: 5159253725,
        encryptedId: '0123456789abcdef0123456789abcdef',
        name: '周末少吃一口-喜欢的音乐'
      }
    }
  }
  assert.deepEqual(extractSongs(favorite), [])
  assert.equal(extractPlaylistIdentifier(favorite), '0123456789abcdef0123456789abcdef')
})

test('songs embedded in the favorite playlist are normalized without treating the playlist as a song', () => {
  assert.deepEqual(extractSongs({
    code: 200,
    data: {
      resource: {
        originalId: 5159253725,
        name: '周末少吃一口-喜欢的音乐',
        songs: [{
          originalId: 2049913337,
          encryptedId: '0123456789abcdef0123456789abcdef',
          name: '夜航',
          artists: [{ name: '甲' }],
          album: { name: '城' }
        }]
      }
    }
  }), [{
    id: '2049913337',
    encryptedId: '0123456789abcdef0123456789abcdef',
    title: '夜航',
    artist: '甲',
    album: '城',
    albumDescription: ''
  }])
})

test('payload diagnostics reveal structure without logging values', () => {
  const summary = summarizePayloadStructure({
    accessToken: 'secret-access-token',
    data: { songs: [{ originalId: 1, name: '私密歌名' }] }
  })
  const text = JSON.stringify(summary)
  assert.match(text, /accessToken/)
  assert.match(text, /originalId/)
  assert.match(text, /array/)
  assert.doesNotMatch(text, /secret-access-token/)
  assert.doesNotMatch(text, /私密歌名/)
})

test('lyric identifiers accept original numeric ids and encrypted hex ids only', () => {
  assert.equal(validSongIdentifier('2049913337'), true)
  assert.equal(validSongIdentifier('0123456789abcdef0123456789abcdef'), true)
  assert.equal(validSongIdentifier('../credentials'), false)
  assert.equal(validSongIdentifier('not-a-song-id'), false)
})

test('login output exposes a small safe status object', () => {
  assert.deepEqual(extractLoginState({ data: { loggedIn: true, nickname: '阿孟', qrUrl: 'https://example.test/qr' } }), {
    loggedIn: true, nickname: '阿孟', qrUrl: 'https://example.test/qr'
  })
  assert.equal(extractLoginState({ loginStatus: '未登录' }).loggedIn, false)
})

test('login status recognizes the CLI isLoggedIn field', () => {
  assert.deepEqual(extractLoginState({ data: { isLoggedIn: true, nickname: '阿孟' } }), {
    loggedIn: true,
    nickname: '阿孟',
    qrUrl: ''
  })
})

test('login status recognizes an authenticated user profile', () => {
  assert.deepEqual(extractLoginState({ data: { profile: { userId: 123, nickname: '阿孟' } } }), {
    loggedIn: true,
    nickname: '阿孟',
    qrUrl: ''
  })
})

test('login check understands the real CLI success payload', () => {
  assert.deepEqual(extractLoginCheckState({ success: true, message: '已登录' }), {
    loggedIn: true,
    nickname: '',
    qrUrl: ''
  })
  assert.deepEqual(extractLoginCheckState({ success: false, message: '未登录，请执行 ncm-cli login 完成登录' }), {
    loggedIn: false,
    nickname: '',
    qrUrl: ''
  })
})

test('cloud service uses the dedicated login-check parser', () => {
  const server = require('node:fs').readFileSync(require('node:path').join(__dirname, '../cloudrun/music-assistant/server.js'), 'utf8')
  assert.match(server, /extractLoginCheckState\(output\)/)
})

test('cloud service logs only a structural summary when liked-song parsing is empty', () => {
  const server = require('node:fs').readFileSync(require('node:path').join(__dirname, '../cloudrun/music-assistant/server.js'), 'utf8')
  assert.match(server, /if \(!songs\.length\)/)
  assert.match(server, /JSON\.stringify\(summarizePayloadStructure\(output\)\)/)
})

test('cloud service resolves the favorite playlist before requesting its tracks', () => {
  const server = require('node:fs').readFileSync(require('node:path').join(__dirname, '../cloudrun/music-assistant/server.js'), 'utf8')
  assert.match(server, /runCli\(\['user', 'favorite'/)
  assert.match(server, /let songs = extractSongs\(favoriteOutput\)/)
  assert.match(server, /if \(!songs\.length\) \{/)
  assert.match(server, /extractPlaylistIdentifier\(favoriteOutput\)/)
  assert.match(server, /runCli\(\['playlist', 'tracks', '--playlistId', playlistId/)
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
