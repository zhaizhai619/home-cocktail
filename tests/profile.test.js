const test = require('node:test')
const assert = require('node:assert/strict')

const {
  PROFILE_STORAGE_KEY,
  createProfileRepository
} = require('../miniprogram/services/profile-repository')

function createMemoryAdapter(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get(key) { return values.get(key) },
    set(key, value) { values.set(key, value) },
    read(key) { return values.get(key) }
  }
}

test('profile repository creates a stable public id and persists editable profile fields', () => {
  const adapter = createMemoryAdapter()
  const repository = createProfileRepository(adapter, {
    idFactory: () => '8f3k2q',
    now: () => '2026-07-28T10:00:00.000Z'
  })

  assert.deepEqual(repository.initialize(), {
    id: '8F3K2Q',
    nickname: '酒友 8F3K2Q',
    avatarPath: '',
    updatedAt: '2026-07-28T10:00:00.000Z'
  })
  assert.deepEqual(repository.getProfile(), adapter.read(PROFILE_STORAGE_KEY))

  const saved = repository.saveProfile({ nickname: '  阿孟  ', avatarPath: '/managed/avatar.png' })
  assert.deepEqual(saved, {
    id: '8F3K2Q',
    nickname: '阿孟',
    avatarPath: '/managed/avatar.png',
    updatedAt: '2026-07-28T10:00:00.000Z'
  })

  const reloaded = createProfileRepository(adapter, { idFactory: () => 'SHOULD-NOT-REPLACE' })
  assert.deepEqual(reloaded.initialize(), saved)
  assert.throws(() => reloaded.saveProfile({ nickname: '   ' }), /名字不能为空/)
})

test('public profile ids keep the changing random suffix rather than a shared timestamp prefix', () => {
  const first = createProfileRepository(createMemoryAdapter(), { idFactory: () => 'same-time-a1b2c3' }).initialize()
  const second = createProfileRepository(createMemoryAdapter(), { idFactory: () => 'same-time-d4e5f6' }).initialize()

  assert.equal(first.id, 'A1B2C3')
  assert.equal(second.id, 'D4E5F6')
  assert.notEqual(first.id, second.id)
})
