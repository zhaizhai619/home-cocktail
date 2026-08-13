function parseJsonContent(content) {
  const source = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(source)
}

function createDeepSeekClient({ fetchImpl = global.fetch, baseUrl = 'https://api.deepseek.com' } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求')
  return {
    async completeJson({ apiKey, model, messages, temperature = 0.2, maxTokens = 1600, thinking = 'disabled', responseFormat = 'json_object' } = {}) {
      if (!String(apiKey || '').trim()) throw new Error('请填写 DeepSeek API Key')
      const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(apiKey).trim()}` },
        body: JSON.stringify({
          model: String(model || 'deepseek-v4-flash'),
          messages: Array.isArray(messages) ? messages : [],
          thinking: { type: thinking === 'enabled' ? 'enabled' : 'disabled' },
          temperature,
          max_tokens: maxTokens,
          response_format: { type: responseFormat === 'json_object' ? 'json_object' : 'text' }
        })
      })
      if (!response.ok) throw new Error(`DeepSeek 请求失败（${response.status || '未知状态'}）`)
      const payload = await response.json()
      const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content
      if (!content) throw new Error('DeepSeek 没有返回可用内容')
      try { return parseJsonContent(content) } catch (_) { throw new Error('DeepSeek 返回的 JSON 无法解析') }
    }
  }
}

module.exports = { createDeepSeekClient, parseJsonContent }
