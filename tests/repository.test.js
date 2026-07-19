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
    imagePath: '',
    source: '',
    tried: false,
    ingredients: [],
    preparations: [],
    glasswareId: null,
    toolIds: [],
    steps: [],
    rating: null,
    tastingNote: '',
    materialObservations: [],
    createdAt: now,
    updatedAt: now
  })
  assert.deepEqual(migrateState(migrated, '2030-01-01T00:00:00.000Z'), migrated)
  assert.deepEqual(migrateState(null, now), createInitialState())
})

test('migration preserves the full recipe shape, user fields, and uses steps canonically', () => {
  const now = '2026-07-20T00:00:00.000Z'
  const recipe = migrateState({ recipes: [{
    id: 'r1', name: 'Martini', imagePath: '/martini.jpg', source: 'book', tried: true,
    ingredients: [{ materialId: 'gin' }], preparations: [{ type: '即调' }], glasswareId: 'coupe',
    toolIds: ['quick-tool-1'], steps: ['Stir'], rating: '顶尖', tastingNote: 'dry',
    materialObservations: [{ materialId: 'gin', note: 'good' }], customField: 'retain me',
    createdAt: now, updatedAt: now
  }] }, now).recipes[0]

  assert.deepEqual(recipe, {
    id: 'r1', name: 'Martini', imagePath: '/martini.jpg', source: 'book', tried: true,
    ingredients: [{ materialId: 'gin' }], preparations: [{ type: '即调' }], glasswareId: 'coupe',
    toolIds: ['quick-tool-1'], steps: ['Stir'], rating: '顶尖', tastingNote: 'dry',
    materialObservations: [{ materialId: 'gin', note: 'good' }], customField: 'retain me',
    createdAt: now, updatedAt: now
  })
  assert.deepEqual(migrateState({ recipes: [{ id: 'legacy', instructions: 'Build' }] }, now).recipes[0].steps, ['Build'])
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
    id: 'id-1', name: 'Negroni', imagePath: '', source: '', tried: false,
    ingredients: [], preparations: [], glasswareId: null, toolIds: [], steps: [],
    rating: null, tastingNote: '', materialObservations: [],
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
  const stocked = repository.addToFreshShelf(material.id, { remainingAmount: 3, remainingUnit: 'piece', purchasedAt: '2026-01-03T00:00:00.000Z', expiresAt: '2026-01-07T00:00:00.000Z' })
  assert.equal(stocked.freshOnHand, true)
  assert.equal(stocked.remainingAmount, 3)
  assert.equal(stocked.remainingUnit, 'piece')
  assert.equal(stocked.purchasedAt, '2026-01-03T00:00:00.000Z')
  assert.equal(stocked.expiresAt, '2026-01-07T00:00:00.000Z')
  const refreshed = repository.updateFreshShelf(material.id, { remainingAmount: 2, expiresAt: '2026-01-08T00:00:00.000Z' })
  assert.equal(refreshed.expiresAt, '2026-01-08T00:00:00.000Z')
  assert.equal(refreshed.remainingAmount, 2)
  assert.equal(repository.removeFromFreshShelf(material.id), true)
  assert.equal(repository.getMaterial(material.id).freshOnHand, false)
  assert.equal(repository.getMaterial(material.id).remainingAmount, null)
  assert.ok(repository.getMaterial(material.id))
  assert.equal(repository.getMaterial('missing'), null)
})

test('material, glassware, and custom tool migration retain canonical and user fields', () => {
  const now = '2026-07-20T00:00:00.000Z'
  const migrated = migrateState({
    materials: [{ id: 'm1', name: 'Milk', category: 'dairy', freshOnHand: true, remainingAmount: 10, remainingUnit: 'ml', purchasedAt: now, expiresAt: now, preferenceNote: 'whole', createdAt: now, updatedAt: now }],
    glassware: [{ id: 'g1', name: 'Highball', capacity: 300, imagePath: '/glass.png', note: 'cold', custom: true }],
    tools: [{ id: 't1', name: 'Torch', voltage: '220v' }]
  }, now)
  assert.deepEqual(migrated.materials[0].remainingAmount, 10)
  assert.equal(migrated.materials[0].preferenceNote, 'whole')
  assert.equal(migrated.materials[0].createdAt, now)
  assert.equal(migrated.glassware.find(({ id }) => id === 'g1').capacity, 300)
  assert.equal(migrated.glassware.find(({ id }) => id === 'g1').custom, true)
  assert.equal(migrated.tools.find(({ id }) => id === 't1').voltage, '220v')
})

test('material migration and writes normalize category aliases and invalid categories', () => {
  const migrated = migrateState({
    materials: [
      { id: 'dairy', category: 'dairy' },
      { id: 'tonic', category: 'tonic' },
      { id: 'invalid', category: 'not-a-category' }
    ]
  }, '2026-01-01T00:00:00.000Z')
  const repository = createRepository(createMemoryAdapter(), {
    idFactory: (() => { let id = 0; return () => `id-${++id}` })()
  })
  repository.initialize()

  assert.deepEqual(migrated.materials.map(({ category }) => category), ['dairy/juice', 'soda/tonic', 'other-liquid'])
  assert.equal(repository.upsertMaterial({ name: 'Milk', category: 'dairy' }).category, 'dairy/juice')
  assert.equal(repository.upsertMaterial({ name: 'Mystery', category: 'not-a-category' }).category, 'other-liquid')
})

test('migration repairs missing and duplicate IDs deterministically in every collection', () => {
  const raw = {
    recipes: [{ id: 'keep' }, {}, { id: '' }, { id: 'keep' }],
    materials: [{ id: 'keep' }, {}, { id: 'keep' }],
    glassware: [{ id: 'keep' }, {}, { id: 'keep' }],
    tools: [{ id: 'quick-tool-1', name: 'Collision' }, { id: 'keep', name: 'Keep' }, {}, { id: 'keep', name: 'Duplicate' }]
  }
  const migrated = migrateState(raw, '2026-01-01T00:00:00.000Z')

  assert.deepEqual(migrated.recipes.map(({ id }) => id), ['keep', 'legacy-recipe-1', 'legacy-recipe-2', 'legacy-recipe-3'])
  assert.deepEqual(migrated.materials.map(({ id }) => id), ['keep', 'legacy-material-1', 'legacy-material-2'])
  assert.deepEqual(migrated.glassware.map(({ id }) => id), ['keep', 'legacy-glassware-1', 'legacy-glassware-2'])
  assert.deepEqual(migrated.tools.slice(QUICK_TOOLS.length).map(({ id }) => id), ['legacy-tool-1', 'keep', 'legacy-tool-2', 'legacy-tool-3'])
  assert.deepEqual(migrateState(migrated, '2030-01-01T00:00:00.000Z'), migrated)
})

test('category transitions reset stale defaults while retaining inventory and explicit same-call overrides', () => {
  const repository = createRepository(createMemoryAdapter(), {
    idFactory: () => 'material',
    now: () => '2026-01-01T00:00:00.000Z'
  })
  repository.initialize()
  const spirit = repository.upsertMaterial({ name: 'Gin', category: 'base-spirit', preferenceNote: 'dry' })
  const stockedSpirit = repository.addToFreshShelf(spirit.id, { remainingAmount: 500, remainingUnit: 'ml' })
  const fruit = repository.upsertMaterial({ ...stockedSpirit, category: 'fruit' })
  const tonic = repository.upsertMaterial({ ...fruit, category: 'tonic', defaultUnit: 'piece' })

  assert.deepEqual({ acquisition: fruit.acquisition, form: fruit.form, defaultUnit: fruit.defaultUnit, alcoholic: fruit.alcoholic, abv: fruit.abv, owned: fruit.owned, freshOnHand: fruit.freshOnHand, trackFreshness: fruit.trackFreshness, assumedAvailable: fruit.assumedAvailable }, { acquisition: 'on-demand', form: 'solid', defaultUnit: 'ml', alcoholic: false, abv: null, owned: false, freshOnHand: false, trackFreshness: true, assumedAvailable: false })
  assert.equal(fruit.remainingAmount, 500)
  assert.equal(fruit.preferenceNote, 'dry')
  assert.equal(tonic.category, 'soda/tonic')
  assert.equal(tonic.defaultUnit, 'piece')
  assert.equal(tonic.form, 'liquid')
  assert.equal(tonic.trackFreshness, false)
})

test('migration clears fresh inventory fields when freshOnHand is false', () => {
  const material = migrateState({ materials: [{ id: 'm1', freshOnHand: false, remainingAmount: 5, remainingUnit: 'piece', purchasedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z' }] }, '2026-01-01T00:00:00.000Z').materials[0]
  assert.deepEqual({ remainingAmount: material.remainingAmount, remainingUnit: material.remainingUnit, purchasedAt: material.purchasedAt, expiresAt: material.expiresAt }, { remainingAmount: null, remainingUnit: null, purchasedAt: null, expiresAt: null })
})

test('material updates preserve createdAt and refresh updatedAt without legacy fresh fields', () => {
  const repository = createRepository(createMemoryAdapter(), {
    idFactory: () => 'm1',
    now: createClock('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')
  })
  repository.initialize()
  const created = repository.upsertMaterial({ name: 'Milk', category: 'dairy' })
  const updated = repository.upsertMaterial({ ...created, preferenceNote: 'whole' })
  const legacy = migrateState({ materials: [{ id: 'legacy', freshOnHand: true, freshAddedAt: '2026-01-01T00:00:00.000Z', freshExpiresAt: '2026-01-03T00:00:00.000Z' }] }, '2026-01-01T00:00:00.000Z').materials[0]

  assert.equal(updated.createdAt, created.createdAt)
  assert.equal(updated.updatedAt, '2026-01-02T00:00:00.000Z')
  assert.equal(legacy.purchasedAt, '2026-01-01T00:00:00.000Z')
  assert.equal('freshAddedAt' in legacy, false)
  assert.equal('freshExpiresAt' in legacy, false)
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
  assert.equal(repository.upsertTool({ id: 'quick-tool-1', name: 'hacked' }), false)
  assert.equal(repository.getTool('quick-tool-1').name, QUICK_TOOLS[0])
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
