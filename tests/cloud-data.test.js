const test = require('node:test')
const assert = require('node:assert/strict')

const { createInitialState } = require('../miniprogram/services/schema')
const {
  CLOUD_CACHE_KEY,
  createCloudUserSession
} = require('../miniprogram/services/cloud-user-session')
const {
  createCloudProfileRepository,
  createCloudRepository
} = require('../miniprogram/services/cloud-repository')
const { createWxCloudTransport } = require('../miniprogram/services/wx-cloud-transport')
const { createCloudAppServices } = require('../miniprogram/services/cloud-app-services')
const {
  diffDeletedItems,
  diffStateChanges,
  applyStateChanges,
  restoreTrashItem
} = require('../cloudfunctions/userData/domain')

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function memoryCache(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]))
  return {
    get(key) { return clone(values.get(key)) },
    set(key, value) { values.set(key, clone(value)) },
    read(key) { return clone(values.get(key)) }
  }
}

function initialProfile() {
  return { id: 'ABC123', nickname: '酒友 ABC123', avatarPath: '', updatedAt: '2026-08-01T00:00:00.000Z' }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

test('state changes contain only added updated and deleted entities', () => {
  const previous = createInitialState()
  previous.recipes.push({ id: 'r1', name: 'Martini' })
  previous.materials.push({ id: 'm1', name: '金酒' })
  const next = clone(previous)
  next.recipes[0].name = 'Dry Martini'
  next.materials.push({ id: 'm2', name: '柠檬汁' })

  const changes = diffStateChanges(previous, next)

  assert.deepEqual(changes, {
    recipes: { upserts: [{ id: 'r1', name: 'Dry Martini' }], deletes: [] },
    materials: { upserts: [{ id: 'm2', name: '柠檬汁' }], deletes: [] },
    glassware: { upserts: [], deletes: [] },
    tools: { upserts: [], deletes: [] }
  })
  assert.deepEqual(applyStateChanges(previous, changes), next)
})

test('applying no entity changes preserves every legacy state field and malformed row', () => {
  const legacy = {
    version: 7,
    recipes: [null, { name: '无 ID 旧配方' }],
    materials: [],
    glassware: [],
    tools: [],
    futureSetting: { enabled: true }
  }
  const unchanged = diffStateChanges(legacy, legacy)

  assert.deepEqual(applyStateChanges(legacy, unchanged), legacy)
})

test('cloud session loads the remote snapshot and uses a separate rebuildable cache', async () => {
  const remoteState = createInitialState()
  remoteState.materials.push({ id: 'm1', name: '金酒', category: 'base-spirit' })
  const cache = memoryCache({
    'home-cocktail-state': { recipes: [{ id: 'legacy-local', name: '不应迁移' }] }
  })
  const session = createCloudUserSession({
    cache,
    initialState: createInitialState(),
    initialProfile: initialProfile(),
    transport: {
      async load() {
        return { state: remoteState, profile: { ...initialProfile(), nickname: '云端用户' }, revision: 4 }
      }
    }
  })

  const status = await session.initialize()

  assert.equal(status.online, true)
  assert.equal(session.getSnapshot().revision, 4)
  assert.equal(session.getSnapshot().state.materials[0].name, '金酒')
  assert.equal(session.getSnapshot().profile.nickname, '云端用户')
  assert.equal(cache.read(CLOUD_CACHE_KEY).state.materials[0].id, 'm1')
  assert.equal(cache.read('home-cocktail-state').recipes[0].id, 'legacy-local')
})

test('a brand new cloud user starts with the supplied empty state and profile', async () => {
  const state = createInitialState()
  const profile = initialProfile()
  const session = createCloudUserSession({
    cache: memoryCache(),
    initialState: state,
    initialProfile: profile,
    transport: { async load() { return { state: null, profile: null, revision: 0 } } }
  })

  await session.initialize()

  assert.deepEqual(session.getSnapshot().state, state)
  assert.deepEqual(session.getSnapshot().profile, profile)
})

test('app cloud services initialize the selected environment without reading legacy business storage', async () => {
  const reads = []
  const writes = []
  const initCalls = []
  const wxApi = {
    getStorageSync(key) { reads.push(key); return undefined },
    setStorageSync(key, value) { writes.push([key, clone(value)]) },
    cloud: {
      init(options) { initCalls.push(options) },
      async callFunction(options) {
        assert.equal(options.name, 'userData')
        return { result: { ok: true, data: { state: null, profile: null, revision: 0 } } }
      },
      async uploadFile() { return { fileID: 'cloud://cloud1.user-media/profile/a.jpg' } },
      async deleteFile() { return {} }
    }
  }

  const services = createCloudAppServices({
    wxApi,
    envId: 'cloud1-test',
    profileIdFactory: () => 'ABC123',
    now: () => '2026-08-01T00:00:00.000Z'
  })
  const status = await services.ready

  assert.deepEqual(initCalls, [{ env: 'cloud1-test', traceUser: true }])
  assert.equal(status.online, true)
  assert.equal(services.repository.listRecipes().length, 0)
  assert.equal(services.profileRepository.getProfile().id, 'ABC123')
  assert.deepEqual(reads, [CLOUD_CACHE_KEY])
  assert.equal(writes[0][0], CLOUD_CACHE_KEY)
  assert.equal(services.mediaFiles.isManagedPath('cloud://cloud1.user-media/profile/a.jpg'), true)
})

test('a business mutation becomes visible only after the cloud confirms it', async () => {
  const pending = deferred()
  const cache = memoryCache()
  const session = createCloudUserSession({
    cache,
    initialState: createInitialState(),
    initialProfile: initialProfile(),
    requestIdFactory: () => 'request-1',
    transport: {
      async load() { return { state: createInitialState(), profile: initialProfile(), revision: 2 } },
      saveChanges(input) {
        assert.equal(input.expectedRevision, 2)
        assert.equal(input.requestId, 'request-1')
        assert.equal(Object.prototype.hasOwnProperty.call(input, 'state'), false)
        assert.equal(input.changes.materials.upserts.length, 1)
        assert.equal(input.changes.materials.upserts[0].id, 'm1')
        assert.equal(input.changes.materials.upserts[0].name, '金酒')
        assert.deepEqual(input.changes.materials.deletes, [])
        assert.deepEqual(input.changes.recipes, { upserts: [], deletes: [] })
        return pending.promise
      }
    }
  })
  await session.initialize()
  const repository = createCloudRepository(session, {
    idFactory: () => 'm1',
    now: () => '2026-08-01T01:00:00.000Z'
  })

  const saving = repository.saveMaterial({ name: '金酒', category: 'base-spirit' })

  assert.deepEqual(repository.listMaterials(), [])
  assert.deepEqual(cache.read(CLOUD_CACHE_KEY).state.materials, [])

  pending.resolve({ revision: 3 })
  const saved = await saving

  assert.equal(saved.id, 'm1')
  assert.equal(repository.listMaterials()[0].name, '金酒')
  assert.equal(cache.read(CLOUD_CACHE_KEY).state.materials[0].id, 'm1')
  assert.equal(session.getSnapshot().revision, 3)
})

test('a rejected cloud write leaves memory and cache at the last confirmed snapshot', async () => {
  const baseState = createInitialState()
  baseState.materials.push({
    id: 'm1', name: '金酒', category: 'base-spirit', acquisition: 'long-term', form: 'liquid', defaultUnit: 'ml',
    alcoholic: true, abv: 40, owned: true, freshOnHand: false, trackFreshness: false, assumedAvailable: false,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z'
  })
  const cache = memoryCache()
  const session = createCloudUserSession({
    cache,
    initialState: createInitialState(),
    initialProfile: initialProfile(),
    transport: {
      async load() { return { state: baseState, profile: initialProfile(), revision: 1 } },
      async saveChanges() { throw new Error('network unavailable') }
    }
  })
  await session.initialize()
  const repository = createCloudRepository(session)

  await assert.rejects(repository.saveMaterial({ ...repository.getMaterial('m1'), name: '伏特加' }), /network unavailable/)

  assert.equal(repository.getMaterial('m1').name, '金酒')
  assert.equal(cache.read(CLOUD_CACHE_KEY).state.materials[0].name, '金酒')
})

test('a lost save acknowledgement is reconciled from cloud without reporting a false failure', async () => {
  let remoteState = createInitialState()
  let revision = 1
  let loads = 0
  const session = createCloudUserSession({
    cache: memoryCache(),
    initialState: createInitialState(),
    initialProfile: initialProfile(),
    transport: {
      async load() { loads++; return { state: remoteState, profile: initialProfile(), revision } },
      async saveChanges(input) {
        remoteState = applyStateChanges(remoteState, input.changes)
        revision = 2
        throw new Error('reply lost')
      }
    }
  })
  await session.initialize()
  const repository = createCloudRepository(session, { idFactory: () => 'm1' })

  const saved = await repository.saveMaterial({ name: '金酒', category: 'base-spirit' })

  assert.equal(saved.id, 'm1')
  assert.equal(repository.getMaterial('m1').name, '金酒')
  assert.equal(session.getSnapshot().revision, 2)
  assert.equal(session.isOnline(), true)
  assert.equal(loads, 2)
})

test('offline startup may read the cloud cache but rejects every write', async () => {
  const cachedState = createInitialState()
  cachedState.recipes.push({ id: 'r1', name: '缓存酒单' })
  const cache = memoryCache({
    [CLOUD_CACHE_KEY]: { state: cachedState, profile: initialProfile(), revision: 9, syncedAt: '2026-08-01T00:00:00.000Z' }
  })
  const session = createCloudUserSession({
    cache,
    initialState: createInitialState(),
    initialProfile: initialProfile(),
    transport: { async load() { throw new Error('offline') } }
  })

  const status = await session.initialize()
  const repository = createCloudRepository(session)

  assert.equal(status.online, false)
  assert.equal(repository.listRecipes()[0].name, '缓存酒单')
  await assert.rejects(repository.deleteRecipe('r1'), /当前离线，只能查看/)
  assert.equal(repository.getRecipe('r1').name, '缓存酒单')
})

test('profile changes follow the same cloud-confirmed write rule', async () => {
  const pending = deferred()
  const session = createCloudUserSession({
    cache: memoryCache(),
    initialState: createInitialState(),
    initialProfile: initialProfile(),
    transport: {
      async load() { return { state: createInitialState(), profile: initialProfile(), revision: 5 } },
      saveProfile(input) {
        assert.equal(input.profile.nickname, '阿孟')
        assert.equal(input.expectedRevision, 5)
        return pending.promise
      }
    }
  })
  await session.initialize()
  const repository = createCloudProfileRepository(session, { now: () => '2026-08-01T02:00:00.000Z' })

  const saving = repository.saveProfile({ nickname: '阿孟' })
  assert.equal(repository.getProfile().nickname, '酒友 ABC123')

  pending.resolve({ revision: 6 })
  const saved = await saving

  assert.equal(saved.nickname, '阿孟')
  assert.equal(repository.getProfile().nickname, '阿孟')
  assert.equal(session.getSnapshot().revision, 6)
})

test('cloud history keeps deleted items recoverable for three days and restore never overwrites a live item', () => {
  const previous = createInitialState()
  previous.recipes.push({ id: 'r1', name: 'Martini' })
  previous.materials.push({ id: 'm1', name: '金酒' })
  const next = createInitialState()
  next.materials.push({ id: 'm1', name: '金酒' })

  const deleted = diffDeletedItems(previous, next, '2026-08-01T03:00:00.000Z', 'request-1')

  assert.deepEqual(deleted.map(({ entityType, item }) => [entityType, item.id]), [['recipe', 'r1']])
  assert.equal(deleted[0].expiresAt, '2026-08-04T03:00:00.000Z')

  const restored = restoreTrashItem(next, deleted[0])
  assert.equal(restored.recipes[0].name, 'Martini')
  assert.throws(() => restoreTrashItem(restored, deleted[0]), /同名记录已经存在/)
})

test('wx cloud transport sends only the action payload and surfaces cloud errors', async () => {
  const calls = []
  const transport = createWxCloudTransport({
    cloud: {
      async callFunction(options) {
        calls.push(clone(options))
        if (options.data.action === 'load') return { result: { ok: true, data: { revision: 3 } } }
        return { result: { ok: false, error: { code: 'REVISION_CONFLICT', message: '数据已更新，请重试' } } }
      }
    },
    functionName: 'userData'
  })

  assert.deepEqual(await transport.load(), { revision: 3 })
  await assert.rejects(
    transport.saveState({ state: createInitialState(), expectedRevision: 2, requestId: 'request-2', ownerOpenId: 'forged' }),
    (error) => error && error.code === 'REVISION_CONFLICT' && /数据已更新/.test(error.message)
  )
  assert.equal(calls[0].name, 'userData')
  assert.deepEqual(calls[0].data, { action: 'load' })
  assert.equal(Object.prototype.hasOwnProperty.call(calls[1].data, 'ownerOpenId'), false)
})

test('restoring trash replaces the confirmed snapshot and advances its revision', async () => {
  const state = createInitialState()
  const restoredState = createInitialState()
  restoredState.recipes.push({ id: 'r1', name: '找回的酒单' })
  const session = createCloudUserSession({
    cache: memoryCache(),
    initialState: createInitialState(),
    initialProfile: initialProfile(),
    transport: {
      async load() { return { state, profile: initialProfile(), revision: 1 } },
      async listTrash() { return [{ id: 'trash-1', entityType: 'recipe', item: { id: 'r1', name: '找回的酒单' } }] },
      async restoreTrash(input) {
        assert.deepEqual(input, { trashId: 'trash-1', expectedRevision: 1, requestId: 'restore-1' })
        return { state: restoredState, revision: 2 }
      }
    },
    requestIdFactory: () => 'restore-1'
  })
  await session.initialize()

  assert.equal((await session.listTrash())[0].id, 'trash-1')
  await session.restoreTrash('trash-1')

  assert.equal(session.getSnapshot().state.recipes[0].name, '找回的酒单')
  assert.equal(session.getSnapshot().revision, 2)
})
