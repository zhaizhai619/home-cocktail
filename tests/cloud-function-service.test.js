const test = require('node:test')
const assert = require('node:assert/strict')

const { createInitialState } = require('../miniprogram/services/schema')
const { createUserDataService } = require('../cloudfunctions/userData/service')

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function memoryStore() {
  const users = new Map()
  const history = []
  const trash = new Map()
  let trashSequence = 0
  const store = {
    async transaction(work) { return work(store) },
    async getUser(openId) { return clone(users.get(openId) || null) },
    async setUser(openId, value) { users.set(openId, clone(value)) },
    async addHistory(value) { history.push(clone(value)) },
    async addTrash(value) {
      const id = `trash-${++trashSequence}`
      trash.set(id, { id, ...clone(value) })
      return id
    },
    async getTrash(id) { return clone(trash.get(id) || null) },
    async markTrashRestored(id, restoredAt) {
      const value = trash.get(id)
      if (value) trash.set(id, { ...value, restoredAt })
    },
    async listTrash(openId, at) {
      return [...trash.values()].filter((item) => item.ownerOpenId === openId && !item.restoredAt && item.expiresAt > at).map(clone)
    },
    async deleteExpired(at) {
      let removed = 0
      for (const [id, item] of trash) {
        if (item.expiresAt <= at || item.restoredAt) {
          trash.delete(id)
          removed += 1
        }
      }
      return { trash: removed, history: 0 }
    },
    inspect() { return { users: clone(Object.fromEntries(users)), history: clone(history), trash: clone([...trash.values()]) } }
  }
  return store
}

function profile(name = '酒友') {
  return { id: 'ABC123', nickname: name, avatarPath: '', updatedAt: '2026-08-01T00:00:00.000Z' }
}

test('cloud service derives ownership from its openId argument and isolates users', async () => {
  const store = memoryStore()
  const service = createUserDataService({ store, now: () => '2026-08-01T00:00:00.000Z' })
  const state = createInitialState()
  state.recipes.push({ id: 'r1', name: 'A 的酒单' })

  await service.saveState('openid-a', { state, expectedRevision: 0, requestId: 'save-a' })

  assert.equal((await service.load('openid-a')).state.recipes[0].name, 'A 的酒单')
  assert.deepEqual(await service.load('openid-b'), { state: null, profile: null, revision: 0 })
  assert.equal(store.inspect().users['openid-a'].ownerOpenId, 'openid-a')
})

test('cloud service rejects stale revisions but treats a retried request as success', async () => {
  const store = memoryStore()
  const service = createUserDataService({ store, now: () => '2026-08-01T00:00:00.000Z' })
  const state = createInitialState()

  assert.deepEqual(await service.saveState('openid-a', { state, expectedRevision: 0, requestId: 'request-1' }), { revision: 1 })
  assert.deepEqual(await service.saveState('openid-a', { state, expectedRevision: 0, requestId: 'request-1' }), { revision: 1 })
  await assert.rejects(
    service.saveState('openid-a', { state, expectedRevision: 0, requestId: 'request-2' }),
    (error) => error && error.code === 'REVISION_CONFLICT'
  )
})

test('saving a deletion keeps its history for 30 days and its trash item for 3 days', async () => {
  let currentTime = '2026-08-01T03:00:00.000Z'
  const store = memoryStore()
  const service = createUserDataService({ store, now: () => currentTime })
  const state = createInitialState()
  state.recipes.push({ id: 'r1', name: 'Martini' })
  await service.saveState('openid-a', { state, expectedRevision: 0, requestId: 'create' })

  const withoutRecipe = createInitialState()
  await service.saveState('openid-a', { state: withoutRecipe, expectedRevision: 1, requestId: 'delete' })

  const persisted = store.inspect()
  assert.equal(persisted.history.length, 1)
  assert.equal(persisted.history[0].previousState.recipes[0].id, 'r1')
  assert.equal(persisted.history[0].expiresAt, '2026-08-31T03:00:00.000Z')
  assert.equal(persisted.trash[0].entityType, 'recipe')
  assert.equal(persisted.trash[0].expiresAt, '2026-08-04T03:00:00.000Z')
  assert.equal((await service.listTrash('openid-a'))[0].item.name, 'Martini')
  assert.deepEqual(await service.listTrash('openid-b'), [])
})

test('trash restore checks ownership, advances the revision and is idempotent', async () => {
  let currentTime = '2026-08-01T03:00:00.000Z'
  const store = memoryStore()
  const service = createUserDataService({ store, now: () => currentTime })
  const state = createInitialState()
  state.recipes.push({ id: 'r1', name: 'Martini' })
  await service.saveState('openid-a', { state, expectedRevision: 0, requestId: 'create' })
  await service.saveState('openid-a', { state: createInitialState(), expectedRevision: 1, requestId: 'delete' })
  const trashId = (await service.listTrash('openid-a'))[0].id

  await assert.rejects(
    service.restoreTrash('openid-b', { trashId, expectedRevision: 0, requestId: 'forged' }),
    (error) => error && error.code === 'TRASH_NOT_FOUND'
  )

  const restored = await service.restoreTrash('openid-a', { trashId, expectedRevision: 2, requestId: 'restore' })
  assert.equal(restored.state.recipes[0].name, 'Martini')
  assert.equal(restored.revision, 3)
  assert.deepEqual(await service.restoreTrash('openid-a', { trashId, expectedRevision: 2, requestId: 'restore' }), restored)
  assert.deepEqual(await service.listTrash('openid-a'), [])
})

test('profile writes are versioned and expired history and trash can be cleaned', async () => {
  let currentTime = '2026-08-01T03:00:00.000Z'
  const store = memoryStore()
  const service = createUserDataService({ store, now: () => currentTime })

  await service.saveProfile('openid-a', { profile: profile('阿孟'), expectedRevision: 0, requestId: 'profile-1' })
  await service.saveProfile('openid-a', { profile: profile('孟孟'), expectedRevision: 1, requestId: 'profile-2' })

  assert.equal((await service.load('openid-a')).profile.nickname, '孟孟')
  assert.equal(store.inspect().history[0].previousProfile.nickname, '阿孟')

  currentTime = '2026-09-01T03:00:00.000Z'
  assert.deepEqual(await service.cleanupExpired(), { trash: 0, history: 0 })
})
