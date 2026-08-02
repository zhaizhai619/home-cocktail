function cloudError(result) {
  const source = result && result.error && typeof result.error === 'object' ? result.error : {}
  const error = new Error(String(source.message || '云端请求失败，请重试'))
  error.code = String(source.code || 'CLOUD_REQUEST_FAILED')
  return error
}

function createWxCloudTransport({ cloud, functionName = 'userData' } = {}) {
  if (!cloud || typeof cloud.callFunction !== 'function') throw new Error('微信云开发不可用')

  async function call(action, payload = {}) {
    const allowedPayload = {}
    for (const key of ['state', 'profile', 'expectedRevision', 'requestId', 'trashId']) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) allowedPayload[key] = payload[key]
    }
    const response = await cloud.callFunction({ name: functionName, data: { action, ...allowedPayload } })
    const result = response && response.result
    if (!result || result.ok !== true) throw cloudError(result)
    return result.data
  }

  return {
    load: () => call('load'),
    saveState: (payload) => call('saveState', payload),
    saveProfile: (payload) => call('saveProfile', payload),
    listTrash: () => call('listTrash'),
    restoreTrash: (payload) => call('restoreTrash', payload)
  }
}

module.exports = { createWxCloudTransport }
