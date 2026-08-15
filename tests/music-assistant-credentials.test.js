const test = require('node:test')
const assert = require('node:assert/strict')

const { createCredentialCipher } = require('../cloudfunctions/musicAssistant/credentials')

test('temporary API credentials are authenticated, context-bound ciphertext', () => {
  const cipher = createCredentialCipher('test-encryption-secret-with-enough-entropy')
  const sealed = cipher.seal('sk-sensitive-value', 'openid-a:job-1')

  assert.equal(JSON.stringify(sealed).includes('sk-sensitive-value'), false)
  assert.equal(cipher.open(sealed, 'openid-a:job-1'), 'sk-sensitive-value')
  assert.throws(() => cipher.open(sealed, 'openid-b:job-1'), /无法解密/)
  const tampered = `${sealed.ciphertext.slice(0, -1)}${sealed.ciphertext.endsWith('A') ? 'B' : 'A'}`
  assert.throws(() => cipher.open({ ...sealed, ciphertext: tampered }, 'openid-a:job-1'), /无法解密/)
})
