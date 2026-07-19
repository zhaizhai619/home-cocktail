const test = require('node:test')
const assert = require('node:assert/strict')

const { QUICK_TOOLS } = require('../miniprogram/domain/constants')
const {
  CURRENT_SCHEMA_VERSION,
  STORAGE_KEY,
  createInitialState,
  migrateState
} = require('../miniprogram/services/schema')
const { createRepository } = require('../miniprogram/services/repository')

function createMemoryAdapter(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get(key) { return values.get(key) },
    set(key, value) { values.set(key, value) },
    read(key) { return values.get(key) }
  }
}

function createClock(...times) {
  let index = 0
  return () => times[Math.min(index++, times.length - 1)]
}

test('initialization persists the exact canonical empty state', () => {
  const adapter = createMemoryAdapter()
  const repository = createRepository(adapter)
  const state = repository.initialize()
  const expectedTools = QUICK_TOOLS.map((name, index) => ({
    id: `quick-tool-${index + 1}`,
    name,
    builtIn: true
  }))

  assert.equal(CURRENT_SCHEMA_VERSION, 1)
  assert.deepEqual(state, {
    version: 1,
    recipes: [],
    materials: [],
    glassware: [],
    tools: expectedTools
  })
  assert.deepEqual(adapter.read(STORAGE_KEY), state)
  assert.deepEqual(createInitialState(), state)
})

test('migration is idempotent and gives invalid recipe dates the supplied timestamp', () => {
  const now = '2026-07-20T00:00:00.000Z'
  const migrated = migrateState({ recipes: [{ id: 'r1', name: 'Martini', createdAt: 'nope' }] }, now)

  assert.deepEqual(migrated.recipes[0], {
    id: 'r1',
    name: 'Martini',
    ingredients: [],
    preparations: [],
    instructions: '',
    rating: null,
    glasswareId: null,
    toolIds: [],
    createdAt: now,
    updatedAt: now
  })
  assert.deepEqual(migrateState(migrated, '2030-01-01T00:00:00.000Z'), migrated)
  assert.deepEqual(migrateState(null, now), createInitialState())
})

test('recipe CRUD assigns IDs and timestamps and preserves createdAt on update', () => {
  const repository = createRepository(createMemoryAdapter(), {
    idFactory: (() => { let id = 0; return () => `id-${++id}` })(),
    now: createClock('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')
  })
  repository.initialize()
  const created = repository.upsertRecipe({ name: 'Negroni' })
  const updated = repository.upsertRecipe({ ...created, name: 'White Negroni' })

  assert.deepEqual(created, {
    id: 'id-1', name: 'Negroni', ingredients: [], preparations: [], instructions: '',
    rating: null, glasswareId: null, toolIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  })
  assert.equal(updated.createdAt, created.createdAt)
  assert.equal(updated.updatedAt, '2026-01-02T00:00:00.000Z')
  assert.equal(repository.getRecipe(created.id).name, 'White Negroni')
  assert.equal(repository.deleteRecipe(created.id), true)
  assert.equal(repository.getRecipe(created.id), null)
  assert.equal(repository.deleteRecipe('missing'), false)
})

test('materials support defaults, classification overrides, long-term ownership, and fresh shelf lifecycle', () => {
  const repository = createRepository(createMemoryAdapter(), {
    idFactory: (() => { let id = 0; return () => `id-${++id}` })(),
    now: () => '2026-01-03T00:00:00.000Z'
  })
  repository.initialize()
  const material = repository.upsertMaterial({ name: 'Lime', category: 'fruit', defaultUnit: 'piece', trackFreshness: false })
  assert.equal(material.acquisition, 'on-demand')
  assert.equal(material.defaultUnit, 'piece')
  assert.equal(material.trackFreshness, false)
  assert.equal(repository.setMaterialOwned(material.id, true).owned, true)
  const stocked = repository.addToFreshShelf(material.id, { addedAt: '2026-01-03T00:00:00.000Z', expiresAt: '2026-01-07T00:00:00.000Z' })
  assert.equal(stocked.freshOnHand, true)
  assert.equal(stocked.freshExpiresAt, '2026-01-07T00:00:00.000Z')
  const refreshed = repository.updateFreshShelf(material.id, { expiresAt: '2026-01-08T00:00:00.000Z' })
  assert.equal(refreshed.freshExpiresAt, '2026-01-08T00:00:00.000Z')
  assert.equal(repository.removeFromFreshShelf(material.id), true)
  assert.equal(repository.getMaterial(material.id).freshOnHand, false)
  assert.ok(repository.getMaterial(material.id))
  assert.equal(repository.getMaterial('missing'), null)
})

test('glassware and custom tools persist while built-ins are retained and protected', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: (() => { let id = 0; return () => `id-${++id}` })() })
  repository.initialize()
  const glass = repository.upsertGlassware({ name: 'Coupe' })
  assert.equal(repository.getGlassware(glass.id).name, 'Coupe')
  assert.equal(repository.deleteGlassware(glass.id), true)
  const custom = repository.upsertTool({ name: '喷枪' })
  assert.deepEqual(custom, { id: 'id-2', name: '喷枪', builtIn: false })
  assert.equal(repository.deleteTool(custom.id), true)
  assert.equal(repository.deleteTool('quick-tool-1'), false)
  assert.equal(repository.listTools().length, QUICK_TOOLS.length)
})

test('writes survive a new instance and returned values cannot mutate stored state', () => {
  const adapter = createMemoryAdapter()
  const first = createRepository(adapter, { idFactory: () => 'persisted' })
  first.initialize()
  const material = first.upsertMaterial({ name: 'Gin', category: 'base-spirit' })
  const state = first.getState()
  state.materials[0].name = 'Changed outside'
  material.name = 'Changed result'
  assert.equal(first.getMaterial('persisted').name, 'Gin')
  const second = createRepository(adapter)
  assert.equal(second.getMaterial('persisted').name, 'Gin')
})
