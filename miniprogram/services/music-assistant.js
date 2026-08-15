const SETTINGS_KEY = 'musicAssistantLocalSettingsV1'

function cloudError(result) {
  const source = result && result.error && typeof result.error === 'object' ? result.error : {}
  const error = new Error(String(source.message || '智能起名请求失败，请重试'))
  error.code = String(source.code || 'MUSIC_ASSISTANT_REQUEST_FAILED')
  return error
}

function createMusicAssistantClient(cloud) {
  if (!cloud || typeof cloud.callFunction !== 'function') throw new Error('微信云开发不可用')
  async function call(action, payload = {}) {
    const response = await cloud.callFunction({ name: 'musicAssistant', data: { action, ...payload } })
    const result = response && response.result
    if (!result || result.ok !== true) throw cloudError(result)
    return result.data
  }
  return {
    getStatus: () => call('getStatus'),
    startJob: (payload) => call('startJob', payload),
    resumeJob: (payload) => call('resumeJob', payload),
    processNext: (payload) => call('processNext', payload),
    recommendNames: (payload) => call('recommendNames', payload),
    startNcmLogin: () => call('startNcmLogin'),
    checkNcmLogin: () => call('checkNcmLogin')
  }
}

function normalizeSettings(value = {}) {
  return {
    apiKey: String(value.apiKey || '').trim(),
    model: String(value.model || 'deepseek-v4-flash').trim() || 'deepseek-v4-flash',
    importCount: Math.max(1, Math.min(300, Number.parseInt(value.importCount, 10) || 20))
  }
}

function createMusicAssistantSettings(wxApi) {
  if (!wxApi || typeof wxApi.getStorageSync !== 'function' || typeof wxApi.setStorageSync !== 'function') throw new Error('本地存储不可用')
  return {
    load() { return normalizeSettings(wxApi.getStorageSync(SETTINGS_KEY) || {}) },
    save(value) {
      const settings = normalizeSettings(value)
      wxApi.setStorageSync(SETTINGS_KEY, settings)
      return settings
    }
  }
}

module.exports = { SETTINGS_KEY, createMusicAssistantClient, createMusicAssistantSettings, normalizeSettings }
