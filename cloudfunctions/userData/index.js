const cloud = require('wx-server-sdk')
const { createCloudStore } = require('./cloud-store')
const { createUserDataService } = require('./service')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const service = createUserDataService({ store: createCloudStore(cloud.database()) })

function success(data) {
  return { ok: true, data }
}

function failure(error) {
  console.error('userData cloud function failed', {
    code: error && error.code,
    message: error && error.message
  })
  return {
    ok: false,
    error: {
      code: String(error && error.code || 'CLOUD_FUNCTION_FAILED'),
      message: String(error && error.message || '云端处理失败，请重试')
    }
  }
}

exports.main = async (event = {}) => {
  try {
    if (event.Type === 'Timer' || event.action === 'cleanupExpired') return success(await service.cleanupExpired())
    const { OPENID } = cloud.getWXContext()
    if (event.action === 'load') return success(await service.load(OPENID))
    if (event.action === 'saveState') return success(await service.saveState(OPENID, event))
    if (event.action === 'saveChanges') return success(await service.saveChanges(OPENID, event))
    if (event.action === 'saveProfile') return success(await service.saveProfile(OPENID, event))
    if (event.action === 'listTrash') return success(await service.listTrash(OPENID))
    if (event.action === 'restoreTrash') return success(await service.restoreTrash(OPENID, event))
    throw Object.assign(new Error('不支持的云端操作'), { code: 'UNKNOWN_ACTION' })
  } catch (error) {
    return failure(error)
  }
}
