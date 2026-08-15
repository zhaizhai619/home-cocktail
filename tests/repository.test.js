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

  assert.equal(CURRENT_SCHEMA_VERSION, 2)
  assert.deepEqual(state, {
    version: 2,
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
    ingredientOrderCustomized: false,
    ingredients: [],
    advancePreparations: [],
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

test('version one migration makes every existing spice a missing long-term material', () => {
  const migrated = migrateState({
    version: 1,
    materials: [
      { id: 'cinnamon', name: '肉桂', category: 'other-solid', acquisition: 'on-demand', freshOnHand: true, trackFreshness: true, remainingAmount: 12, remainingUnit: 'g', purchasedAt: '2026-08-01', expiresAt: '2026-09-01' },
      { id: 'bitters', name: '苦精', category: 'bitters', acquisition: 'on-demand', freshOnHand: true },
      { id: 'lime', name: '青柠', category: 'fruit', acquisition: 'on-demand', freshOnHand: true }
    ]
  }, '2026-08-13T00:00:00.000Z')

  for (const id of ['cinnamon', 'bitters']) {
    const spice = migrated.materials.find((material) => material.id === id)
    assert.equal(spice.acquisition, 'long-term')
    assert.equal(spice.owned, false)
    assert.equal(spice.freshOnHand, false)
    assert.equal(spice.assumedAvailable, false)
    assert.equal(spice.remainingAmount, null)
    assert.equal(spice.remainingUnit, null)
    assert.equal(spice.purchasedAt, null)
    assert.equal(spice.expiresAt, null)
  }
  assert.equal(migrated.materials.find((material) => material.id === 'lime').freshOnHand, true)
  assert.equal(migrated.version, 2)
  assert.deepEqual(migrateState(migrated, '2030-01-01T00:00:00.000Z'), migrated)
})

test('current schema preserves a user-selected quick-buy spice', () => {
  const migrated = migrateState({
    version: CURRENT_SCHEMA_VERSION,
    materials: [{ id: 'mint', name: '薄荷', category: 'other-solid', acquisition: 'on-demand', freshOnHand: true }]
  }, '2026-08-13T00:00:00.000Z')

  assert.equal(migrated.materials[0].acquisition, 'on-demand')
  assert.equal(migrated.materials[0].freshOnHand, true)
})

test('migration preserves the full recipe shape, user fields, and uses steps canonically', () => {
  const now = '2026-07-20T00:00:00.000Z'
  const recipe = migrateState({ recipes: [{
    id: 'r1', name: 'Martini', imagePath: '/martini.jpg', source: 'book', tried: true, ingredientOrderCustomized: true,
    ingredients: [{ materialId: 'gin' }], advancePreparations: [], preparations: [{ type: '即调' }], glasswareId: 'coupe',
    toolIds: ['quick-tool-1'], steps: ['Stir'], rating: '顶尖', tastingNote: 'dry',
    materialObservations: [{ materialId: 'gin', note: 'good' }], customField: 'retain me',
    createdAt: now, updatedAt: now
  }] }, now).recipes[0]

  assert.deepEqual(recipe, {
    id: 'r1', name: 'Martini', imagePath: '/martini.jpg', source: 'book', tried: true, ingredientOrderCustomized: true,
    ingredients: [{ materialId: 'gin' }], advancePreparations: [], preparations: [{ type: '即调' }], glasswareId: 'coupe',
    toolIds: ['quick-tool-1'], steps: ['Stir'], rating: '顶尖', tastingNote: 'dry',
    materialObservations: [{ materialId: 'gin', note: 'good' }], customField: 'retain me',
    createdAt: now, updatedAt: now
  })
  assert.deepEqual(migrateState({ recipes: [{ id: 'legacy', instructions: 'Build' }] }, now).recipes[0].steps, ['Build'])
  assert.deepEqual(
    migrateState({ recipes: [{ id: 'legacy-preparation', preparations: [{ type: '其他预制', amount: 4, unit: 'hour' }] }] }, now).recipes[0].preparations,
    [{ type: '其他预调', amount: 4, unit: 'hour' }]
  )
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
    ingredientOrderCustomized: false,
    ingredients: [], advancePreparations: [], preparations: [], glasswareId: null, toolIds: [], steps: [],
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
  const material = repository.upsertMaterial({ name: 'Lime', category: 'fruit', defaultUnit: 'piece', trackFreshness: true })
  assert.equal(material.acquisition, 'on-demand')
  assert.equal(material.defaultUnit, 'piece')
  assert.equal(material.trackFreshness, true)
  const longTerm = repository.upsertMaterial({ name: 'Violet', category: 'liqueur', alcoholic: true, abv: 20 })
  assert.equal(repository.setMaterialOwned(longTerm.id, true).owned, true)
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
  assert.equal(migrated.glassware.find(({ id }) => id === 'g1').capacityMl, 300)
  assert.equal(migrated.glassware.find(({ id }) => id === 'g1').notes, 'cold')
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

test('migration merges legacy rum into white rum and remaps every recipe reference', () => {
  const now = '2026-07-20T00:00:00.000Z'
  const raw = {
    materials: [
      { id: 'white-rum', name: '白朗姆', category: 'base-spirit', owned: false, abv: 38, preferenceNote: '保留白朗姆设置' },
      { id: 'rum', name: '朗姆', category: 'base-spirit', owned: true, abv: 40, preferenceNote: '不覆盖标准材料' },
      { id: 'dark-rum', name: '黑朗姆', category: 'other-base-spirit', owned: true, abv: 43 }
    ],
    recipes: [{
      id: 'daiquiri',
      ingredients: [{ materialId: 'rum', amount: 45, unit: 'ml' }, { materialId: 'dark-rum', amount: 5, unit: 'ml' }],
      materialObservations: [{ materialId: 'rum', note: '清爽' }, { materialId: 'dark-rum', note: '厚重' }]
    }]
  }

  const migrated = migrateState(raw, now)

  assert.deepEqual(migrated.materials.map(({ id, name }) => ({ id, name })), [
    { id: 'white-rum', name: '白朗姆' },
    { id: 'dark-rum', name: '黑朗姆' }
  ])
  assert.equal(migrated.materials[0].owned, false)
  assert.equal(migrated.materials[0].abv, 38)
  assert.equal(migrated.materials[0].preferenceNote, '保留白朗姆设置')
  assert.deepEqual(migrated.recipes[0].ingredients.map(({ materialId }) => materialId), ['white-rum', 'dark-rum'])
  assert.deepEqual(migrated.recipes[0].materialObservations.map(({ materialId }) => materialId), ['white-rum', 'dark-rum'])
  assert.deepEqual(migrateState(migrated, '2030-01-01T00:00:00.000Z'), migrated)
})

test('migration renames a lone rum in place and leaves specific rum styles untouched', () => {
  const now = '2026-07-20T00:00:00.000Z'
  const raw = {
    materials: [
      { id: 'rum', name: '朗姆', category: 'base-spirit', owned: false, abv: 37, preferenceNote: '保留原设置' },
      { id: 'dark', name: '黑朗姆', category: 'base-spirit', owned: true, abv: 43 },
      { id: 'gold', name: '金朗姆', category: 'base-spirit', owned: true, abv: 40 },
      { id: 'aged', name: '陈年朗姆', category: 'base-spirit', owned: true, abv: 45 }
    ],
    recipes: [{ id: 'r1', ingredients: [{ materialId: 'rum' }], materialObservations: [{ materialId: 'rum', note: '清爽' }] }]
  }

  const migrated = migrateState(raw, now)

  assert.deepEqual(migrated.materials.map(({ id, name }) => ({ id, name })), [
    { id: 'rum', name: '白朗姆' },
    { id: 'dark', name: '黑朗姆' },
    { id: 'gold', name: '金朗姆' },
    { id: 'aged', name: '陈年朗姆' }
  ])
  assert.equal(migrated.materials[0].owned, false)
  assert.equal(migrated.materials[0].abv, 37)
  assert.equal(migrated.materials[0].preferenceNote, '保留原设置')
  assert.equal(migrated.recipes[0].ingredients[0].materialId, 'rum')
  assert.equal(migrated.recipes[0].materialObservations[0].materialId, 'rum')
})

test('migration does not collapse two native white rum records without an alias', () => {
  const now = '2026-07-20T00:00:00.000Z'
  const raw = {
    materials: [
      { id: 'white-a', name: '白朗姆', category: 'base-spirit', owned: false, abv: 38 },
      { id: 'white-b', name: '白朗姆', category: 'base-spirit', owned: true, abv: 40 }
    ],
    recipes: [{ id: 'r1', ingredients: [{ materialId: 'white-a' }, { materialId: 'white-b' }] }]
  }

  const migrated = migrateState(raw, now)

  assert.deepEqual(migrated.materials.map(({ id }) => id), ['white-a', 'white-b'])
  assert.deepEqual(migrated.recipes[0].ingredients.map(({ materialId }) => materialId), ['white-a', 'white-b'])
})

test('migration consolidates ordinary syrup aliases into the canonical material and remaps recipe references', () => {
  const now = '2026-07-20T00:00:00.000Z'
  const raw = {
    materials: [
      { id: 'simple', name: '普通糖浆', category: 'syrup/staple', owned: false, assumedAvailable: false, preferenceNote: '保留标准材料设置' },
      { id: 'syrup', name: '糖浆', category: 'syrup/staple', owned: true, preferenceNote: '旧简称' },
      { id: 'single', name: '单糖浆', category: 'syrup/staple', owned: true, preferenceNote: '旧术语' },
      { id: 'honey', name: '蜂蜜糖浆', category: 'syrup/staple', owned: true }
    ],
    recipes: [{
      id: 'r1',
      ingredients: [{ materialId: 'syrup' }, { materialId: 'single' }, { materialId: 'honey' }],
      materialObservations: [{ materialId: 'syrup', note: '甜度合适' }, { materialId: 'single', note: '也是同一种' }]
    }]
  }

  const migrated = migrateState(raw, now)

  assert.deepEqual(migrated.materials.map(({ id, name }) => ({ id, name })), [
    { id: 'simple', name: '普通糖浆' },
    { id: 'honey', name: '蜂蜜糖浆' }
  ])
  assert.equal(migrated.materials[0].owned, false)
  assert.equal(migrated.materials[0].preferenceNote, '保留标准材料设置')
  assert.deepEqual(migrated.recipes[0].ingredients.map(({ materialId }) => materialId), ['simple', 'simple', 'honey'])
  assert.deepEqual(migrated.recipes[0].materialObservations.map(({ materialId }) => materialId), ['simple', 'simple'])
  assert.deepEqual(migrateState(migrated, '2030-01-01T00:00:00.000Z'), migrated)
})

test('migration renames a lone syrup alias in place without changing its settings or references', () => {
  const now = '2026-07-20T00:00:00.000Z'
  const migrated = migrateState({
    materials: [{ id: 'syrup', name: '单糖浆', category: 'syrup/staple', owned: false, assumedAvailable: false, preferenceNote: '少甜' }],
    recipes: [{ id: 'r1', ingredients: [{ materialId: 'syrup' }], materialObservations: [{ materialId: 'syrup', note: '减量' }] }]
  }, now)

  assert.deepEqual(migrated.materials.map(({ id, name, owned, preferenceNote }) => ({ id, name, owned, preferenceNote })), [
    { id: 'syrup', name: '普通糖浆', owned: false, preferenceNote: '少甜' }
  ])
  assert.equal(migrated.recipes[0].ingredients[0].materialId, 'syrup')
  assert.equal(migrated.recipes[0].materialObservations[0].materialId, 'syrup')
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

test('migration canonicalizes legacy equipment names and capacities without losing IDs or references', () => {
  const raw = {
    glassware: [
      { id: 'g-empty', name: '  ', capacityMl: 0 },
      { id: 'g-coupe', name: ' Coupe ', capacityMl: 6001 },
      { id: 'g-coupe-2', name: 'coupe', capacityMl: 'bad' }
    ],
    tools: [
      { id: 't-empty', name: '' },
      { id: 't-smoke', name: ' Smoke Gun ' },
      { id: 't-smoke-2', name: 'smoke  gun' },
      { id: 't-fixed-name', name: QUICK_TOOLS[0] }
    ],
    recipes: [{ id: 'r1', glasswareId: 'g-empty', toolIds: ['t-empty', 't-fixed-name'] }]
  }
  const migrated = migrateState(raw, '2026-01-01T00:00:00.000Z')

  assert.deepEqual(migrated.glassware.map(({ id, name, capacityMl }) => ({ id, name, capacityMl })), [
    { id: 'g-empty', name: '未命名酒杯', capacityMl: null },
    { id: 'g-coupe', name: 'Coupe', capacityMl: null },
    { id: 'g-coupe-2', name: 'coupe', capacityMl: null }
  ])
  assert.deepEqual(migrated.tools.slice(QUICK_TOOLS.length).map(({ id, name }) => ({ id, name })), [
    { id: 't-empty', name: '未命名用具' },
    { id: 't-smoke', name: 'Smoke Gun' },
    { id: 't-smoke-2', name: 'smoke gun (2)' },
    { id: 't-fixed-name', name: `${QUICK_TOOLS[0]} (2)` }
  ])
  assert.equal(migrated.recipes[0].glasswareId, 'g-empty')
  assert.deepEqual(migrated.recipes[0].toolIds, ['t-empty', 't-fixed-name'])
  assert.deepEqual(migrateState(migrated, '2030-01-01T00:00:00.000Z'), migrated)
})

test('migration keeps every invalid legacy glass capacity explicit instead of inventing a value', () => {
  const migrated = migrateState({ glassware: [
    { id: 'missing' }, { id: 'null', capacityMl: null }, { id: 'blank', capacityMl: '' },
    { id: 'zero', capacityMl: 0 }, { id: 'nan', capacityMl: 'nope' }, { id: 'large', capacityMl: 5000.1 },
    { id: 'valid', capacityMl: 250.5 }
  ] }, '2026-01-01T00:00:00.000Z')

  assert.deepEqual(migrated.glassware.map(({ capacityMl }) => capacityMl), [null, null, null, null, null, null, 250.5])
  assert.deepEqual(migrateState(migrated, '2030-01-01T00:00:00.000Z'), migrated)
})

test('migration remaps custom tool IDs that collide with built-ins and updates recipe references', () => {
  const raw = {
    tools: [
      { id: 'quick-tool-1', name: '我的喷枪' },
      { id: 'quick-tool-2', name: '我的冰锤' },
      { id: 'legacy-tool-1', name: '保留原 ID' }
    ],
    recipes: [{ id: 'r1', toolIds: ['quick-tool-1', 'quick-tool-2', 'quick-tool-1', 'legacy-tool-1'] }]
  }
  const migrated = migrateState(raw, '2026-01-01T00:00:00.000Z')
  const custom = migrated.tools.slice(QUICK_TOOLS.length)

  assert.deepEqual(custom.map(({ id }) => id), ['legacy-tool-2', 'legacy-tool-3', 'legacy-tool-1'])
  assert.deepEqual(migrated.recipes[0].toolIds, ['legacy-tool-2', 'legacy-tool-3', 'legacy-tool-1'])
  assert.equal(migrated.tools.find(({ id }) => id === migrated.recipes[0].toolIds[0]).name, '我的喷枪')
  assert.notEqual(migrated.recipes[0].toolIds[0], 'quick-tool-1')
  assert.deepEqual(migrateState(migrated, '2030-01-01T00:00:00.000Z'), migrated)
})

test('migration treats prototype-like tool IDs as data and never leaks non-string references', () => {
  const raw = {
    tools: [
      { id: 'quick-tool-1', name: '冲突用具' },
      { id: 'toString', name: 'To String' },
      { id: '__proto__', name: 'Proto' },
      { id: 'constructor', name: 'Constructor' }
    ],
    recipes: [{ id: 'r1', toolIds: ['quick-tool-1', 'toString', '__proto__', 'constructor'] }]
  }
  const migrated = migrateState(raw, '2026-01-01T00:00:00.000Z')

  assert.deepEqual(migrated.recipes[0].toolIds, ['legacy-tool-1', 'toString', '__proto__', 'constructor'])
  assert.ok(migrated.recipes[0].toolIds.every((id) => typeof id === 'string'))
  assert.deepEqual(migrateState(migrated, '2030-01-01T00:00:00.000Z'), migrated)
})

test('category transitions reset stale defaults while retaining inventory and explicit same-call overrides', () => {
  const adapter = createMemoryAdapter()
  const repository = createRepository(adapter, {
    idFactory: () => 'material',
    now: () => '2026-01-01T00:00:00.000Z'
  })
  repository.initialize()
  const spirit = repository.upsertMaterial({ name: 'Gin', category: 'base-spirit', preferenceNote: 'dry' })
  const fruit = repository.upsertMaterial({ ...spirit, category: 'fruit' })

  assert.deepEqual({ acquisition: fruit.acquisition, form: fruit.form, defaultUnit: fruit.defaultUnit, alcoholic: fruit.alcoholic, abv: fruit.abv, owned: fruit.owned, freshOnHand: fruit.freshOnHand, trackFreshness: fruit.trackFreshness, assumedAvailable: fruit.assumedAvailable }, { acquisition: 'on-demand', form: 'solid', defaultUnit: 'ml', alcoholic: false, abv: null, owned: false, freshOnHand: false, trackFreshness: true, assumedAvailable: false })
  assert.deepEqual({ remainingAmount: fruit.remainingAmount, remainingUnit: fruit.remainingUnit, purchasedAt: fruit.purchasedAt, expiresAt: fruit.expiresAt }, { remainingAmount: null, remainingUnit: null, purchasedAt: null, expiresAt: null })
  assert.equal(fruit.preferenceNote, 'dry')
  assert.deepEqual(createRepository(adapter).getMaterial(fruit.id), fruit)
  const tonic = repository.upsertMaterial({ ...fruit, category: 'tonic', defaultUnit: 'piece' })
  assert.equal(tonic.category, 'soda/tonic')
  assert.equal(tonic.defaultUnit, 'piece')
  assert.equal(tonic.form, 'liquid')
  assert.equal(tonic.trackFreshness, false)
})

test('a category transition keeps supplied fresh inventory only when on-hand and tracking are explicitly enabled', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: () => 'm1' })
  repository.initialize()
  const fruit = repository.upsertMaterial({ name: 'Lime', category: 'fruit' })
  const tonic = repository.saveMaterial({ id: fruit.id, category: 'tonic', freshOnHand: true, trackFreshness: true, remainingAmount: 2, remainingUnit: 'piece', purchasedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z' })
  assert.deepEqual({ freshOnHand: tonic.freshOnHand, remainingAmount: tonic.remainingAmount, remainingUnit: tonic.remainingUnit }, { freshOnHand: true, remainingAmount: 2, remainingUnit: 'piece' })
})

test('migration clears batch-only inventory fields and dates when the material is unavailable', () => {
  const material = migrateState({ materials: [{ id: 'm1', freshOnHand: false, remainingAmount: 5, remainingUnit: 'piece', purchasedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z' }] }, '2026-01-01T00:00:00.000Z').materials[0]
  assert.deepEqual({ remainingAmount: material.remainingAmount, remainingUnit: material.remainingUnit, purchasedAt: material.purchasedAt, expiresAt: material.expiresAt }, { remainingAmount: null, remainingUnit: null, purchasedAt: null, expiresAt: null })
  assert.equal(migrateState({ materials: [{ id: 'invalid-date', purchasedAt: '2026-02-30' }] }, '2026-01-01T00:00:00.000Z').materials[0].purchasedAt, null)
  assert.equal(migrateState({ materials: [{ id: 'invalid-suffix', purchasedAt: '2026-02-28junk' }] }, '2026-01-01T00:00:00.000Z').materials[0].purchasedAt, null)
})

test('material updates preserve createdAt and refresh updatedAt without legacy fresh fields', () => {
  const repository = createRepository(createMemoryAdapter(), {
    idFactory: () => 'm1',
    now: createClock('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')
  })
  repository.initialize()
  const created = repository.upsertMaterial({ name: 'Milk', category: 'dairy' })
  const updated = repository.upsertMaterial({ ...created, preferenceNote: 'whole' })
  const legacy = migrateState({ materials: [{ id: 'legacy', freshOnHand: true, trackFreshness: true, freshAddedAt: '2026-01-01T00:00:00.000Z', freshExpiresAt: '2026-01-03T00:00:00.000Z' }] }, '2026-01-01T00:00:00.000Z').materials[0]

  assert.equal(updated.createdAt, created.createdAt)
  assert.equal(updated.updatedAt, '2026-01-02T00:00:00.000Z')
  assert.equal(legacy.purchasedAt, '2026-01-01T00:00:00.000Z')
  assert.equal('freshAddedAt' in legacy, false)
  assert.equal('freshExpiresAt' in legacy, false)
})

test('glassware and custom tools persist while built-ins are retained and protected', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: (() => { let id = 0; return () => `id-${++id}` })() })
  repository.initialize()
  const glass = repository.upsertGlassware({ name: 'Coupe', capacityMl: 180 })
  assert.equal(repository.getGlassware(glass.id).name, 'Coupe')
  assert.equal(repository.deleteGlassware(glass.id), true)
  const custom = repository.upsertTool({ name: '喷枪' })
  assert.deepEqual(custom, { id: 'id-2', name: '喷枪', builtIn: false })
  assert.equal(repository.deleteTool(custom.id), true)
  assert.throws(() => repository.upsertTool({ id: 'quick-tool-1', name: 'hacked' }), /固定用具/)
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

test('recipe save transaction reuses normalized materials and commits recipe plus drafts once', () => {
  const repository = createRepository(createMemoryAdapter(), {
    idFactory: (() => { let id = 0; return () => `id-${++id}` })(), now: () => '2026-01-01T00:00:00.000Z'
  })
  repository.initialize()
  const limeDraft = { draftKey: 'citrus:青柠汁', category: 'citrus', name: ' 青柠汁 ', defaultUnit: 'ml' }
  const makeRecipe = (name, draftKey = limeDraft.draftKey) => ({ name, ingredients: [{ materialId: '', draftKey, amount: 25, unit: 'ml' }], materialObservations: [{ materialId: '', draftKey, note: '新鲜' }] })
  const first = repository.saveRecipeWithMaterials(makeRecipe('第一杯'), [limeDraft])
  const second = repository.saveRecipeWithMaterials(makeRecipe('第二杯'), [limeDraft])
  const other = repository.saveRecipeWithMaterials(makeRecipe('第三杯', 'other-liquid:青柠汁'), [{ draftKey: 'other-liquid:青柠汁', category: 'other-liquid', name: '青柠汁', defaultUnit: 'ml' }])

  assert.equal(repository.listMaterials().length, 2)
  assert.equal(first.ingredients[0].materialId, second.ingredients[0].materialId)
  assert.notEqual(second.ingredients[0].materialId, other.ingredients[0].materialId)
  assert.deepEqual(first.materialObservations, [{ materialId: first.ingredients[0].materialId, note: '新鲜' }])
  assert.equal('draftKey' in first.ingredients[0], false)
})

test('untried recipes create every new material as unavailable regardless of category defaults', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: (() => { let id = 0; return () => `untried-${++id}` })() })
  repository.initialize()
  const drafts = [
    { draftKey: 'base-spirit:金酒', category: 'base-spirit', name: '金酒', defaultUnit: 'ml' },
    { draftKey: 'citrus:青柠汁', category: 'citrus', name: '青柠汁', defaultUnit: 'ml' },
    { draftKey: 'syrup/staple:普通糖浆', category: 'syrup/staple', name: '普通糖浆', defaultUnit: 'ml' }
  ]
  repository.saveRecipeWithMaterials({
    name: '待尝试酒款',
    tried: false,
    ingredients: drafts.map(({ draftKey }) => ({ materialId: '', draftKey, amount: 20, unit: 'ml' }))
  }, drafts)

  for (const material of repository.listMaterials()) {
    assert.equal(material.owned, false, material.name)
    assert.equal(material.freshOnHand, false, material.name)
    assert.equal(material.assumedAvailable, false, material.name)
  }
})

test('an untried recipe reuses an existing material without changing its availability', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: (() => { let id = 0; return () => `existing-${++id}` })() })
  repository.initialize()
  const citrus = repository.saveMaterial({ name: '青柠汁', category: 'citrus', owned: true, assumedAvailable: true })
  repository.saveRecipeWithMaterials({
    name: '待尝试酸酒',
    tried: false,
    ingredients: [{ materialId: '', draftKey: 'citrus:青柠汁', amount: 20, unit: 'ml' }]
  }, [{ draftKey: 'citrus:青柠汁', category: 'citrus', name: '青柠汁', defaultUnit: 'ml' }])

  assert.equal(repository.listMaterials().length, 1)
  assert.equal(repository.getMaterial(citrus.id).owned, true)
  assert.equal(repository.getMaterial(citrus.id).assumedAvailable, true)
})

test('tried recipes keep the category availability defaults for new materials', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: (() => { let id = 0; return () => `tried-${++id}` })() })
  repository.initialize()
  repository.saveRecipeWithMaterials({
    name: '已经调过',
    tried: true,
    ingredients: [{ materialId: '', draftKey: 'base-spirit:伏特加', amount: 45, unit: 'ml' }]
  }, [{ draftKey: 'base-spirit:伏特加', category: 'base-spirit', name: '伏特加', defaultUnit: 'ml' }])

  assert.equal(repository.listMaterials()[0].owned, true)
})

test('recipe transaction resolves advance input drafts without persisting the prepared output as a material', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: (() => { let id = 0; return () => `advance-${++id}` })(), now: () => '2026-01-01T00:00:00.000Z' })
  repository.initialize()
  const saved = repository.saveRecipeWithMaterials({
    name: '菠萝朗姆嗨棒', ingredients: [{ kind: 'prepared-output', preparationId: 'prep-1', amount: 40, unit: 'ml' }],
    advancePreparations: [{
      id: 'prep-1',
      outputName: '菠萝朗姆',
      ingredients: [{ materialId: '', draftKey: 'fruit:菠萝', amount: 200, unit: 'g' }],
      steps: ['浸泡后过滤']
    }]
  }, [{ draftKey: 'fruit:菠萝', category: 'fruit', name: '菠萝', defaultUnit: 'g' }])
  const materials = repository.listMaterials()
  assert.deepEqual(materials.map(({ name }) => name), ['菠萝'])
  assert.deepEqual(saved.ingredients[0], { kind: 'prepared-output', preparationId: 'prep-1', amount: 40, unit: 'ml' })
  assert.equal(saved.advancePreparations[0].outputName, '菠萝朗姆')
  assert.equal(saved.advancePreparations[0].ingredients[0].materialId, materials[0].id)
  assert.equal(repository.getMaterialUsageCount(materials[0].id), 1)
  assert.equal(repository.deleteMaterial(materials[0].id).reason, 'referenced')
})

test('migration upgrades the old single advance preparation and adds its serving usage once', () => {
  const migrated = migrateState({ recipes: [{
    id: 'legacy-prep', name: '旧预制酒', ingredients: [{ materialId: 'soda', amount: null, unit: 'top-up' }],
    advancePreparation: { outputName: '菠萝朗姆', ingredients: [{ materialId: 'rum', amount: 500, unit: 'ml' }], steps: ['过滤'] }
  }] }, '2026-01-01T00:00:00.000Z')
  const recipe = migrated.recipes[0]
  assert.equal('advancePreparation' in recipe, false)
  assert.equal(recipe.advancePreparations.length, 1)
  assert.equal(recipe.advancePreparations[0].outputName, '菠萝朗姆')
  assert.deepEqual(recipe.ingredients.filter(({ kind }) => kind === 'prepared-output'), [{ kind: 'prepared-output', preparationId: recipe.advancePreparations[0].id, amount: null, unit: 'to-taste' }])
  assert.deepEqual(migrateState(migrated, '2030-01-01T00:00:00.000Z'), migrated)
})

test('recipe save transaction rolls back all in-memory and storage changes when its final write fails', () => {
  const adapter = createMemoryAdapter()
  const originalSet = adapter.set
  let fail = false
  adapter.set = (key, value) => { if (fail) throw new Error('storage unavailable'); originalSet(key, value) }
  const repository = createRepository(adapter, { idFactory: () => 'new-id', now: () => '2026-01-01T00:00:00.000Z' })
  repository.initialize()
  const before = repository.getState()
  fail = true
  assert.throws(() => repository.saveRecipeWithMaterials({ name: '失败', ingredients: [{ materialId: '', draftKey: 'liqueur:君度', amount: 20, unit: 'ml' }] }, [{ draftKey: 'liqueur:君度', category: 'liqueur', name: '君度' }]), /storage unavailable/)
  assert.deepEqual(repository.getState(), before)
  assert.deepEqual(adapter.read(STORAGE_KEY), before)
})

test('recipe save transaction uses a case-insensitive trimmed identity key for materials', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: (() => { let id = 0; return () => `id-${++id}` })() })
  repository.initialize()
  const save = (name) => repository.saveRecipeWithMaterials({ name, ingredients: [{ materialId: '', draftKey: 'base-spirit:gin', amount: 45, unit: 'ml' }] }, [{ draftKey: 'base-spirit:gin', category: 'base-spirit', name }])
  const first = save(' Gin ')
  const second = save('gin')
  assert.equal(repository.listMaterials().length, 1)
  assert.equal(first.ingredients[0].materialId, second.ingredients[0].materialId)
})

test('material writes and recipe drafts store plain rum as white rum without creating a duplicate', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: (() => { let id = 0; return () => `id-${++id}` })() })
  repository.initialize()
  const whiteRum = repository.saveMaterial({ name: '白朗姆', category: 'base-spirit', abv: 40 })
  const recipe = repository.saveRecipeWithMaterials({
    name: '代基里',
    ingredients: [{ materialId: '', draftKey: 'base-spirit:朗姆', amount: 45, unit: 'ml' }]
  }, [{ draftKey: 'base-spirit:朗姆', category: 'base-spirit', name: '朗姆', abv: 40 }])

  assert.equal(repository.listMaterials().length, 1)
  assert.equal(repository.listMaterials()[0].name, '白朗姆')
  assert.equal(recipe.ingredients[0].materialId, whiteRum.id)
  const reused = repository.saveMaterial({ name: '朗姆', category: 'base-spirit', abv: 40 })
  assert.equal(reused.id, whiteRum.id)
  assert.equal(repository.listMaterials().length, 1)
})

test('material writes reuse ordinary syrup for both short aliases without overwriting its settings', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: (() => { let id = 0; return () => `id-${++id}` })() })
  repository.initialize()
  const ordinary = repository.saveMaterial({ name: '普通糖浆', category: 'syrup/staple', owned: false, preferenceNote: '少甜' })

  const fromShortName = repository.saveMaterial({ name: '糖浆', category: 'syrup/staple', owned: true })
  const fromTechnicalName = repository.saveMaterial({ name: '单糖浆', category: 'syrup/staple', owned: true })

  assert.equal(fromShortName.id, ordinary.id)
  assert.equal(fromTechnicalName.id, ordinary.id)
  assert.equal(repository.listMaterials().length, 1)
  assert.equal(repository.getMaterial(ordinary.id).owned, false)
  assert.equal(repository.getMaterial(ordinary.id).preferenceNote, '少甜')
})

test('recipe save transaction atomically updates a missing existing material ABV and rejects invalid values', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: (() => { let id = 0; return () => `id-${++id}` })() })
  repository.initialize()
  const liqueur = repository.upsertMaterial({ name: '君度', category: 'liqueur' })
  const saved = repository.saveRecipeWithMaterials({ name: '白色佳人', ingredients: [{ materialId: liqueur.id, amount: 20, unit: 'ml' }] }, [], [{ id: liqueur.id, abv: 40 }])
  assert.equal(repository.getMaterial(liqueur.id).abv, 40)
  assert.equal(saved.ingredients[0].materialId, liqueur.id)
  assert.throws(() => repository.saveRecipeWithMaterials({ name: '不应保存', ingredients: [] }, [], [{ id: liqueur.id, abv: 0 }]), /Invalid ABV/)
  assert.equal(repository.listRecipes().length, 1)
  assert.equal(repository.getMaterial(liqueur.id).abv, 40)
})

test('recipe save transaction rejects invalid supplied ABV on new alcoholic drafts before any state change', () => {
  const repository = createRepository(createMemoryAdapter(), { idFactory: () => 'new-id' })
  repository.initialize()
  const before = repository.getState()
  for (const abv of [-5, 0, 101, Number.NaN]) {
    assert.throws(() => repository.saveRecipeWithMaterials({ name: '不应保存', ingredients: [{ materialId: '', draftKey: 'liqueur:bad', amount: 20, unit: 'ml' }] }, [{ draftKey: 'liqueur:bad', category: 'liqueur', name: 'Bad', alcoholic: true, abv }]), /Invalid ABV/)
    assert.deepEqual(repository.getState(), before)
  }
})
