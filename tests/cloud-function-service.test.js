const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createInitialState } = require('../miniprogram/services/schema')
const { createUserDataService } = require('../cloudfunctions/userData/service')

test('cloud deployment keeps userData timeout above the default three seconds', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cloudbaserc.json'), 'utf8'))
  const userData = config.functions.find((item) => item.name === 'userData')

  assert.equal(config.envId, 'cloud1-d3gbs4a2yb36e552b')
  assert.equal(userData.timeout, 10)
})

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function memoryStore() {
  const users = new Map()
  const history = []
  const trash = new Map()
  const entities = new Map()
  let entityListReads = 0
  let trashSequence = 0
  const store = {
    async transaction(work) { return work(store) },
    async getUser(openId) { return clone(users.get(openId) || null) },
    async setUser(openId, value) { users.set(openId, clone(value)) },
    async listEntityChanges(openId) {
      entityListReads += 1
      return [...entities.values()].filter((item) => item.ownerOpenId === openId).map(clone)
    },
    async getEntityChange(openId, entityType, entityId) {
      return clone(entities.get(`${openId}:${entityType}:${entityId}`) || null)
    },
    async setEntityChange(openId, entityType, entityId, value) {
      entities.set(`${openId}:${entityType}:${entityId}`, clone({ ownerOpenId: openId, entityType, entityId, ...value }))
    },
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
    inspect() {
      return {
        users: clone(Object.fromEntries(users)),
        entities: clone([...entities.values()]),
        entityListReads,
        history: clone(history),
        trash: clone([...trash.values()])
      }
    }
  }
  return store
}

test('incremental saves preserve the legacy snapshot and write only changed entities', async () => {
  const store = memoryStore()
  const legacy = createInitialState()
  legacy.recipes.push({ id: 'r1', name: 'Martini' })
  legacy.materials.push({ id: 'm1', name: '金酒' })
  await store.setUser('openid-a', { ownerOpenId: 'openid-a', state: legacy, revision: 4 })
  const service = createUserDataService({ store, now: () => '2026-08-01T00:00:00.000Z' })

  const response = await service.saveChanges('openid-a', {
    changes: {
      recipes: { upserts: [{ id: 'r2', name: 'Gimlet' }], deletes: [] },
      materials: { upserts: [{ id: 'm1', name: '伏特加' }], deletes: [] },
      glassware: { upserts: [], deletes: [] },
      tools: { upserts: [], deletes: [] }
    },
    expectedRevision: 4,
    requestId: 'incremental-1'
  })

  assert.deepEqual(response, { revision: 5 })
  const persisted = store.inspect()
  assert.equal(persisted.entityListReads, 0)
  assert.deepEqual(persisted.users['openid-a'].state, legacy)
  assert.equal(persisted.entities.length, 2)
  assert.deepEqual(persisted.entities.map((item) => [item.entityType, item.entityId]).sort(), [['material', 'm1'], ['recipe', 'r2']])
  assert.deepEqual((await service.load('openid-a')).state.recipes.map((item) => item.id), ['r1', 'r2'])
  assert.equal((await service.load('openid-a')).state.materials[0].name, '伏特加')
  assert.deepEqual(persisted.history[0].previousEntities, [
    { entityType: 'recipe', entityId: 'r2', item: null },
    { entityType: 'material', entityId: 'm1', item: { id: 'm1', name: '金酒' } }
  ])
})

test('cloud load retries when an incremental commit lands between metadata and entity reads', async () => {
  const baseline = createInitialState()
  baseline.materials.push({ id: 'm1', name: '金酒' })
  let userReads = 0
  let entityReads = 0
  const store = {
    async transaction() { throw new Error('not used') },
    async getUser() {
      userReads += 1
      return { ownerOpenId: 'openid-a', state: baseline, revision: userReads === 1 ? 1 : 2 }
    },
    async listEntityChanges() {
      entityReads += 1
      return entityReads === 1 ? [] : [{
        ownerOpenId: 'openid-a', entityType: 'material', entityId: 'm1', deleted: false,
        value: { id: 'm1', name: '伏特加' }
      }]
    }
  }
  const service = createUserDataService({ store })

  const loaded = await service.load('openid-a')

  assert.equal(loaded.revision, 2)
  assert.equal(loaded.state.materials[0].name, '伏特加')
  assert.equal(entityReads, 2)
})

test('legacy full saves keep top-level state fields and may replace more than 200 entities', async () => {
  const store = memoryStore()
  const service = createUserDataService({ store, now: () => '2026-08-01T00:00:00.000Z' })
  const state = createInitialState()
  state.version = 7
  state.futureSetting = { enabled: true }
  state.materials = Array.from({ length: 205 }, (_, index) => ({ id: `m${index}`, name: `材料${index}` }))

  await service.saveState('openid-a', { state, expectedRevision: 0, requestId: 'legacy-bulk' })

  const loaded = await service.load('openid-a')
  assert.equal(loaded.state.version, 7)
  assert.deepEqual(loaded.state.futureSetting, { enabled: true })
  assert.equal(loaded.state.materials.length, 205)
  assert.deepEqual(store.inspect().users['openid-a'].state, state)
})

test('incremental delete after a legacy full reset trashes the reset value instead of a stale overlay', async () => {
  const store = memoryStore()
  const service = createUserDataService({ store, now: () => '2026-08-01T00:00:00.000Z' })
  const original = createInitialState()
  original.recipes.push({ id: 'r1', name: '原始版' })
  await service.saveState('openid-a', { state: original, expectedRevision: 0, requestId: 'create' })
  await service.saveChanges('openid-a', {
    changes: {
      recipes: { upserts: [{ id: 'r1', name: '增量版' }], deletes: [] },
      materials: { upserts: [], deletes: [] }, glassware: { upserts: [], deletes: [] }, tools: { upserts: [], deletes: [] }
    }, expectedRevision: 1, requestId: 'incremental'
  })
  const reset = createInitialState()
  reset.recipes.push({ id: 'r1', name: '全量重置版' })
  await service.saveState('openid-a', { state: reset, expectedRevision: 2, requestId: 'reset' })

  await service.saveChanges('openid-a', {
    changes: {
      recipes: { upserts: [], deletes: ['r1'] },
      materials: { upserts: [], deletes: [] }, glassware: { upserts: [], deletes: [] }, tools: { upserts: [], deletes: [] }
    }, expectedRevision: 3, requestId: 'delete-after-reset'
  })

  const trash = await service.listTrash('openid-a')
  assert.equal(trash[0].item.name, '全量重置版')
  const restored = await service.restoreTrash('openid-a', {
    trashId: trash[0].id,
    expectedRevision: 4,
    requestId: 'restore-after-reset'
  })
  assert.equal(restored.state.recipes[0].name, '全量重置版')
})

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
