const cloud = require('wx-server-sdk')
const fetchImpl = require('node-fetch')
const { createMusicStore } = require('./cloud-store')
const { createDeepSeekClient } = require('./deepseek')
const { createNcmClient } = require('./ncm-client')
const { createMusicAssistantService } = require('./service')
const { createCredentialCipher } = require('./credentials')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function credentialCipher() {
  return createCredentialCipher(process.env.MUSIC_ASSISTANT_CREDENTIAL_KEY || process.env.NCM_SERVICE_TOKEN)
}

const service = createMusicAssistantService({
  store: createMusicStore(cloud.database()),
  ai: createDeepSeekClient({ fetchImpl }),
  ncm: createNcmClient({ baseUrl: process.env.NCM_SERVICE_URL, token: process.env.NCM_SERVICE_TOKEN, fetchImpl }),
  credentials: {
    seal(value, context) { return credentialCipher().seal(value, context) },
    open(payload, context) { return credentialCipher().open(payload, context) }
  }
})

function success(data) { return { ok: true, data } }

function failure(error) {
  console.error('musicAssistant failed', { code: error && error.code, message: error && error.message })
  return {
    ok: false,
    error: {
      code: String(error && error.code || 'MUSIC_ASSISTANT_FAILED'),
      message: String(error && error.message || '智能起名暂时不可用，请稍后再试')
    }
  }
}

exports.main = async (event = {}) => {
  try {
    if (event.Type === 'Timer') return success(await service.runBackground({ maxSongs: 6 }))
    const { OPENID } = cloud.getWXContext()
    if (event.action === 'getStatus') return success(await service.getStatus(OPENID))
    if (event.action === 'startJob') return success(await service.startJob(OPENID, event))
    if (event.action === 'resumeJob') return success(await service.resumeJob(OPENID, event))
    if (event.action === 'processNext') return success(await service.processNext(OPENID, event))
    if (event.action === 'recommendNames') return success(await service.recommendNames(OPENID, event))
    if (event.action === 'startNcmLogin') return success(await service.startNcmLogin(OPENID))
    if (event.action === 'checkNcmLogin') return success(await service.checkNcmLogin(OPENID))
    throw Object.assign(new Error('不支持的智能起名操作'), { code: 'UNKNOWN_ACTION' })
  } catch (error) {
    return failure(error)
  }
}
