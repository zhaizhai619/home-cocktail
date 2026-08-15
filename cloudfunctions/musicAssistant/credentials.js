const crypto = require('crypto')

function createCredentialCipher(secret) {
  const source = String(secret || '').trim()
  if (source.length < 24) throw new Error('后台任务加密密钥尚未配置')
  const key = crypto.createHash('sha256').update(`music-assistant:${source}`).digest()

  return {
    seal(value, context) {
      const plaintext = String(value || '').trim()
      if (!plaintext) throw new Error('请先填写 DeepSeek API Key')
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from(String(context || '')))
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return {
        version: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64')
      }
    },
    open(payload, context) {
      try {
        if (!payload || payload.version !== 1) throw new Error('invalid credential')
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'))
        decipher.setAAD(Buffer.from(String(context || '')))
        decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
        return Buffer.concat([
          decipher.update(Buffer.from(payload.ciphertext, 'base64')),
          decipher.final()
        ]).toString('utf8')
      } catch (_) {
        throw new Error('后台任务凭证无法解密，请重新开始解析')
      }
    }
  }
}

module.exports = { createCredentialCipher }
