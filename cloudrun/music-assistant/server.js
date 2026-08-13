const http = require('http')
const crypto = require('crypto')
const QRCode = require('qrcode')
const { spawn } = require('child_process')
const { extractSongs, extractLyrics, extractLoginState, buildLoginStartState, publicLoginError } = require('./ncm-output')

const PORT = Number(process.env.PORT) || 8080
const SERVICE_TOKEN = String(process.env.SERVICE_TOKEN || '')
const APP_ID = String(process.env.NCM_APP_ID || '')
const PRIVATE_KEY = String(process.env.NCM_PRIVATE_KEY || '').replace(/\\n/g, '\n')
const CLI_HOME = String(process.env.NCM_HOME || '/data/ncm')

function runCli(args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn('ncm-cli', args, { env: { ...process.env, HOME: CLI_HOME }, shell: false })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('网易云 CLI 执行超时')) }, timeout)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const safeStderr = [PRIVATE_KEY, SERVICE_TOKEN].filter(Boolean).reduce((value, secret) => value.split(secret).join('[redacted]'), stderr)
      if (code !== 0) return reject(new Error(`网易云 CLI 执行失败（${code}）${safeStderr ? `：${safeStderr.slice(-200)}` : ''}`))
      const trimmed = stdout.trim()
      try { return resolve(JSON.parse(trimmed)) } catch (_) {}
      const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean).reverse()
      for (const line of lines) {
        try { return resolve(JSON.parse(line)) } catch (_) {}
      }
      resolve({ output: trimmed })
    })
  })
}

async function configure() {
  if (!SERVICE_TOKEN || !APP_ID || !PRIVATE_KEY) throw new Error('缺少 SERVICE_TOKEN、NCM_APP_ID 或 NCM_PRIVATE_KEY')
  await runCli(['config', 'set', 'appId', APP_ID])
  await runCli(['config', 'set', 'privateKey', PRIVATE_KEY])
}

const configured = configure()

function authorized(header) {
  const supplied = Buffer.from(String(header || '').replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(SERVICE_TOKEN)
  return supplied.length === expected.length && expected.length > 0 && crypto.timingSafeEqual(supplied, expected)
}

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function handler(request, response) {
  if (request.url === '/health') return send(response, 200, { ok: true })
  if (!authorized(request.headers.authorization)) return send(response, 401, { ok: false, error: 'unauthorized' })
  try {
    await configured
    const url = new URL(request.url, 'http://localhost')
    if (request.method === 'POST' && url.pathname === '/auth/start') {
      const output = await runCli(['login', '--background', '--output', 'json'])
      const state = await buildLoginStartState(output, (content) => QRCode.toDataURL(content, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 360
      }))
      return send(response, 200, { ok: true, data: state })
    }
    if (request.method === 'GET' && url.pathname === '/auth/status') {
      const output = await runCli(['login', '--check', '--output', 'json'])
      return send(response, 200, { ok: true, data: extractLoginState(output) })
    }
    if (request.method === 'GET' && url.pathname === '/library/liked') {
      const limit = Math.max(1, Math.min(300, Number(url.searchParams.get('limit')) || 20))
      const output = await runCli(['user', 'favorite', '--userInput', '获取红心歌单', '--output', 'json'])
      return send(response, 200, { ok: true, data: { songs: extractSongs(output).slice(0, limit) } })
    }
    const lyricMatch = request.method === 'GET' && url.pathname.match(/^\/songs\/([^/]+)\/lyrics$/)
    if (lyricMatch) {
      const songId = decodeURIComponent(lyricMatch[1])
      if (!/^\d+$/.test(songId)) return send(response, 400, { ok: false, error: 'invalid_song_id' })
      const output = await runCli(['song', 'lyric', '--songId', songId, '--userInput', '获取歌词', '--output', 'json'])
      return send(response, 200, { ok: true, data: { lyrics: extractLyrics(output) } })
    }
    return send(response, 404, { ok: false, error: 'not_found' })
  } catch (error) {
    console.error('music-assistant service failed', { message: error && error.message })
    const knownCode = error && /^NCM_/.test(String(error.code || ''))
    const message = knownCode ? error.message : publicLoginError(error && error.message)
    return send(response, 500, {
      ok: false,
      error: { code: knownCode ? error.code : 'NCM_SERVICE_UNAVAILABLE', message }
    })
  }
}

http.createServer(handler).listen(PORT, '0.0.0.0', () => console.log(`music-assistant listening on ${PORT}`))
