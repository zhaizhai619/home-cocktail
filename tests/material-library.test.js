const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { STORAGE_KEY, migrateState } = require('../miniprogram/services/schema')
const { createRepository } = require('../miniprogram/services/repository')
const { getMaterialVisualState } = require('../miniprogram/domain/material')
const {
  buildMaterialLibrary,
  buildGlasswareCards,
  prepareGlasswareForSave,
  MATERIAL_LIBRARY_TABS,
  formatInventory,
  formatExpiry,
  getLocalDateOrdinal,
  buildFreshFormState,
  ensureLibraryMaterial,
  orchestrateFreshUseUp,
  orchestrateFreshUndo
} = require('../miniprogram/pages/materials/model')
const {
  buildMaterialDetail,
  decodeMaterialId,
  validateMaterialObservation,
  orchestrateMaterialObservationSave
} = require('../miniprogram/pages/material-detail/model')
const { validateMaterialForm, orchestrateMaterialSave, materialSaveNavigation } = require('../miniprogram/pages/material-edit/model')

function memoryAdapter(initial, failSet = () => false) {
  const values = new Map(initial ? [[STORAGE_KEY, structuredClone(initial)]] : [])
  return {
    get(key) { return structuredClone(values.get(key)) },
    set(key, value) {
      if (failSet(value)) throw new Error('storage full')
      values.set(key, structuredClone(value))
    },
    read() { return structuredClone(values.get(STORAGE_KEY)) }
  }
}

function repositoryOptions() {
  let id = 0
  let tick = 0
  return {
    idFactory: () => `generated-${++id}`,
    now: () => `2026-07-${String(++tick).padStart(2, '0')}T00:00:00.000Z`
  }
}

test('repository independently creates and edits every material field atomically', () => {
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  const created = repository.saveMaterial({
    name: '椰浆', category: 'dairy/juice', acquisition: 'on-demand', form: 'liquid',
    defaultUnit: 'ml', alcoholic: false, abv: null, trackFreshness: true,
    freshOnHand: true, remainingAmount: 200, remainingUnit: 'ml',
    purchasedAt: '2026-07-20', expiresAt: '2026-07-24'
  })
  const updated = repository.saveMaterial({
    ...created, name: '厚椰乳', acquisition: 'long-term', owned: false,
    freshOnHand: false, remainingAmount: null, expiresAt: null
  })

  assert.equal(created.id, 'generated-1')
  assert.deepEqual({
    name: updated.name, category: updated.category, acquisition: updated.acquisition,
    form: updated.form, defaultUnit: updated.defaultUnit, alcoholic: updated.alcoholic,
    abv: updated.abv, trackFreshness: updated.trackFreshness, owned: updated.owned,
    freshOnHand: updated.freshOnHand, remainingAmount: updated.remainingAmount
  }, {
    name: '厚椰乳', category: 'dairy/juice', acquisition: 'long-term', form: 'liquid',
    defaultUnit: 'ml', alcoholic: false, abv: null, trackFreshness: true,
    owned: false, freshOnHand: false, remainingAmount: null
  })
  assert.equal(updated.createdAt, created.createdAt)
})

test('standalone material create and rename enforce trimmed case-insensitive identity per category', () => {
  const adapter = memoryAdapter()
  const repository = createRepository(adapter, repositoryOptions())
  repository.initialize()
  const gin = repository.saveMaterial({ name: 'Gin', category: 'base-spirit' })
  const baseline = repository.getState()
  assert.throws(() => repository.saveMaterial({ name: ' gin ', category: 'base-spirit' }), /Material already exists/)
  assert.deepEqual(repository.getState(), baseline)
  assert.deepEqual(adapter.read(), baseline)
  const otherCategory = repository.saveMaterial({ name: ' gin ', category: 'liqueur', alcoholic: true, abv: 20 })
  assert.equal(otherCategory.name, 'gin')
  const vodka = repository.saveMaterial({ name: 'Vodka', category: 'base-spirit' })
  const beforeRename = repository.getState()
  assert.throws(() => repository.saveMaterial({ ...vodka, name: ' GIN ' }), /Material already exists/)
  assert.deepEqual(repository.getState(), beforeRename)
  assert.equal(repository.getMaterial(gin.id).name, 'Gin')
})

test('repository rejects invalid category, status, ABV, amount, unit and dates without writes', () => {
  const adapter = memoryAdapter()
  const repository = createRepository(adapter, repositoryOptions())
  repository.initialize()
  const baseline = adapter.read()
  const invalid = [
    { name: 'X', category: 'unknown' },
    { name: 'X', category: 'fruit', acquisition: 'later' },
    { name: 'X', category: 'liqueur', alcoholic: true, abv: 0 },
    { name: 'X', category: 'liqueur', alcoholic: true, abv: 101 },
    { name: 'X', category: 'liqueur', owned: 'yes' },
    { name: 'X', category: 'fruit', freshOnHand: 'yes' },
    { name: 'X', category: 'fruit', freshOnHand: true, remainingAmount: -1 },
    { name: 'X', category: 'fruit', freshOnHand: true, remainingUnit: 'bucket' },
    { name: 'X', category: 'fruit', freshOnHand: true, expiresAt: 'not-a-date' },
    { name: 'X', category: 'base-spirit', purchasedAt: '2026-02-30' },
    { name: 'X', category: 'base-spirit', purchasedAt: '2026-02-28junk' }
  ]
  for (const draft of invalid) assert.throws(() => repository.saveMaterial(draft), /Invalid material/)
  assert.deepEqual(adapter.read(), baseline)
})

test('long-term ownership and fresh inventory lifecycle are separate and use-up is undoable once', () => {
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  const spirit = repository.saveMaterial({ name: '紫罗兰利口酒', category: 'liqueur', alcoholic: true, abv: 20 })
  assert.equal(repository.setMaterialOwned(spirit.id, true).owned, true)
  assert.equal(repository.setMaterialOwned(spirit.id, false).owned, false)

  const fruit = repository.saveMaterial({ name: '西瓜', category: 'fruit' })
  const stocked = repository.addToFreshShelf(fruit.id, { remainingAmount: 500, remainingUnit: 'g', expiresAt: '2026-07-25' })
  assert.deepEqual({ freshOnHand: stocked.freshOnHand, trackFreshness: stocked.trackFreshness, remainingAmount: stocked.remainingAmount, remainingUnit: stocked.remainingUnit }, { freshOnHand: true, trackFreshness: true, remainingAmount: 500, remainingUnit: 'g' })
  const used = repository.useUpFreshMaterial(fruit.id)
  assert.equal(used.removed, true)
  assert.equal(repository.getMaterial(fruit.id).freshOnHand, false)
  assert.ok(repository.getMaterial(fruit.id))
  assert.equal(repository.restoreFreshMaterial(fruit.id, used.undoToken).freshOnHand, true)
  assert.equal(repository.restoreFreshMaterial(fruit.id, used.undoToken), null)
})

test('every acquisition type can be available and optionally track one current batch', () => {
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  assert.equal(typeof repository.setMaterialAvailable, 'function')
  assert.equal(typeof repository.setMaterialTracking, 'function')

  const gin = repository.saveMaterial({
    name: '金酒', category: 'base-spirit', owned: true, trackFreshness: true,
    remainingAmount: 500, remainingUnit: 'ml', purchasedAt: '2026-07-01', expiresAt: '2027-07-01'
  })
  assert.deepEqual({ owned: gin.owned, tracked: gin.trackFreshness, amount: gin.remainingAmount, unit: gin.remainingUnit, purchasedAt: gin.purchasedAt, expiresAt: gin.expiresAt }, {
    owned: true, tracked: true, amount: 500, unit: 'ml', purchasedAt: '2026-07-01', expiresAt: '2027-07-01'
  })

  const missingGin = repository.setMaterialAvailable(gin.id, false)
  assert.deepEqual({ owned: missingGin.owned, tracked: missingGin.trackFreshness, amount: missingGin.remainingAmount, purchasedAt: missingGin.purchasedAt, expiresAt: missingGin.expiresAt }, {
    owned: false, tracked: true, amount: null, purchasedAt: null, expiresAt: null
  })
  const restockedGin = repository.setMaterialAvailable(gin.id, true)
  assert.equal(restockedGin.owned, true)
  assert.ok(restockedGin.purchasedAt)
  const untrackedGin = repository.setMaterialTracking(gin.id, false)
  assert.deepEqual({ owned: untrackedGin.owned, tracked: untrackedGin.trackFreshness, amount: untrackedGin.remainingAmount, expiresAt: untrackedGin.expiresAt }, {
    owned: true, tracked: false, amount: null, expiresAt: null
  })

  const datedRum = repository.saveMaterial({ name: '白朗姆', category: 'base-spirit', owned: true, trackFreshness: false, purchasedAt: '2026-06-01' })
  assert.equal(repository.setMaterialTracking(datedRum.id, true).purchasedAt, '2026-06-01')

  const watermelon = repository.saveMaterial({ name: '西瓜', category: 'fruit', freshOnHand: false })
  const stockedWatermelon = repository.setMaterialAvailable(watermelon.id, true)
  assert.deepEqual({ owned: stockedWatermelon.owned, freshOnHand: stockedWatermelon.freshOnHand, tracked: stockedWatermelon.trackFreshness }, {
    owned: false, freshOnHand: true, tracked: true
  })
})

test('explicit ownership overrides assumed staples and rolls back on storage failure', () => {
  let fail = false
  const adapter = memoryAdapter(undefined, () => fail)
  const repository = createRepository(adapter, repositoryOptions())
  repository.initialize()
  const lemon = repository.saveMaterial({ name: '柠檬汁', category: 'citrus' })
  const syrup = repository.saveMaterial({ name: '糖浆', category: 'syrup/staple' })
  assert.deepEqual({ owned: lemon.owned, assumedAvailable: lemon.assumedAvailable, state: getMaterialVisualState(lemon) }, { owned: true, assumedAvailable: true, state: 'owned' })
  const editedSyrup = repository.saveMaterial({ ...syrup, preferenceNote: '普通编辑不应取消常备' })
  assert.equal(editedSyrup.assumedAvailable, true)
  const missing = repository.setMaterialOwned(lemon.id, false)
  assert.deepEqual({ owned: missing.owned, assumedAvailable: missing.assumedAvailable, state: getMaterialVisualState(missing) }, { owned: false, assumedAvailable: false, state: 'missing-long-term' })
  const ownedAgain = repository.setMaterialOwned(lemon.id, true)
  assert.deepEqual({ owned: ownedAgain.owned, assumedAvailable: ownedAgain.assumedAvailable, state: getMaterialVisualState(ownedAgain) }, { owned: true, assumedAvailable: false, state: 'owned' })
  const baseline = repository.getState()
  fail = true
  assert.throws(() => repository.setMaterialOwned(syrup.id, false), /storage full/)
  assert.deepEqual(repository.getState(), baseline)
  assert.deepEqual(adapter.read(), baseline)
})

test('migration aligns legacy assumed staples and invalid acquisition states', () => {
  const migrated = migrateState({ materials: [
    { id: 'lemon', name: '柠檬汁', category: 'citrus', acquisition: 'long-term', assumedAvailable: true, trackFreshness: false, owned: false, freshOnHand: true, remainingAmount: 2 },
    { id: 'fruit', name: '西瓜', category: 'fruit', acquisition: 'on-demand', owned: true, freshOnHand: true, trackFreshness: false },
    { id: 'corrupt', name: '损坏数据', category: 'other-liquid', acquisition: 'on-demand', alcoholic: 'yes', owned: 'yes', assumedAvailable: 'yes', freshOnHand: 'yes', trackFreshness: 'yes' }
  ] }, '2026-07-20T00:00:00.000Z').materials
  assert.deepEqual({ owned: migrated[0].owned, assumedAvailable: migrated[0].assumedAvailable, freshOnHand: migrated[0].freshOnHand, remainingAmount: migrated[0].remainingAmount }, { owned: true, assumedAvailable: true, freshOnHand: false, remainingAmount: null })
  assert.deepEqual({ owned: migrated[1].owned, freshOnHand: migrated[1].freshOnHand }, { owned: false, freshOnHand: true })
  assert.deepEqual({ alcoholic: migrated[2].alcoholic, owned: migrated[2].owned, assumedAvailable: migrated[2].assumedAvailable, freshOnHand: migrated[2].freshOnHand, trackFreshness: migrated[2].trackFreshness }, { alcoholic: false, owned: false, assumedAvailable: false, freshOnHand: false, trackFreshness: false })
})

test('migration replaces invalid acquisition with category defaults and clears incompatible status', () => {
  const migrated = migrateState({ materials: [
    { id: 'fruit', name: '西瓜', category: 'fruit', acquisition: 'teleport', owned: true, freshOnHand: true, trackFreshness: true, remainingAmount: 5, remainingUnit: 'piece' },
    { id: 'gin', name: '金酒', category: 'base-spirit', acquisition: 'teleport', owned: false, freshOnHand: true, trackFreshness: true, remainingAmount: 500, remainingUnit: 'ml' }
  ] }, '2026-07-20T00:00:00.000Z').materials
  assert.deepEqual({ acquisition: migrated[0].acquisition, owned: migrated[0].owned, freshOnHand: migrated[0].freshOnHand, remainingAmount: migrated[0].remainingAmount }, { acquisition: 'on-demand', owned: false, freshOnHand: true, remainingAmount: 5 })
  assert.deepEqual({ acquisition: migrated[1].acquisition, owned: migrated[1].owned, freshOnHand: migrated[1].freshOnHand, remainingAmount: migrated[1].remainingAmount }, { acquisition: 'long-term', owned: false, freshOnHand: false, remainingAmount: null })
})

test('fresh on-hand and freshness tracking remain independent through every combination', () => {
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  const tonic = repository.saveMaterial({ name: '汤力水', category: 'soda/tonic', trackFreshness: false })
  const stocked = repository.addToFreshShelf(tonic.id, { remainingAmount: 2, remainingUnit: 'piece', expiresAt: '2026-07-25' })
  assert.deepEqual({ freshOnHand: stocked.freshOnHand, trackFreshness: stocked.trackFreshness, remainingAmount: stocked.remainingAmount, expiresAt: stocked.expiresAt }, { freshOnHand: true, trackFreshness: false, remainingAmount: null, expiresAt: null })

  const tracked = repository.saveMaterial({ ...stocked, trackFreshness: true, remainingAmount: 2, remainingUnit: 'piece', expiresAt: '2026-07-25' })
  assert.deepEqual({ freshOnHand: tracked.freshOnHand, trackFreshness: tracked.trackFreshness, remainingAmount: tracked.remainingAmount }, { freshOnHand: true, trackFreshness: true, remainingAmount: 2 })
  const untracked = repository.saveMaterial({ ...tracked, trackFreshness: false })
  assert.deepEqual({ freshOnHand: untracked.freshOnHand, trackFreshness: untracked.trackFreshness, remainingAmount: untracked.remainingAmount, remainingUnit: untracked.remainingUnit, expiresAt: untracked.expiresAt }, { freshOnHand: true, trackFreshness: false, remainingAmount: null, remainingUnit: null, expiresAt: null })
  const offHand = repository.saveMaterial({ ...untracked, freshOnHand: false, trackFreshness: true, remainingAmount: 8, remainingUnit: 'piece' })
  assert.deepEqual({ freshOnHand: offHand.freshOnHand, trackFreshness: offHand.trackFreshness, remainingAmount: offHand.remainingAmount }, { freshOnHand: false, trackFreshness: true, remainingAmount: null })
})

test('inventory APIs reject acquisition-incompatible state without mutation', () => {
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  const gin = repository.saveMaterial({ name: '金酒', category: 'base-spirit' })
  const fruit = repository.saveMaterial({ name: '西瓜', category: 'fruit' })
  const baseline = repository.getState()
  assert.throws(() => repository.addToFreshShelf(gin.id), /Invalid material availability/)
  assert.throws(() => repository.updateFreshShelf(gin.id, { remainingAmount: 1 }), /Invalid material availability/)
  assert.throws(() => repository.setMaterialOwned(fruit.id, true), /Invalid material availability/)
  assert.throws(() => repository.saveMaterial({ ...gin, freshOnHand: true }), /Invalid material availability/)
  assert.throws(() => repository.saveMaterial({ ...fruit, owned: true }), /Invalid material availability/)
  assert.deepEqual(repository.getState(), baseline)
})

test('migration clears inventory metadata for untracked on-hand materials without clearing on-hand', () => {
  const tonic = migrateState({ materials: [{ id: 'tonic', name: '汤力水', category: 'soda/tonic', freshOnHand: true, trackFreshness: false, remainingAmount: 2, remainingUnit: 'piece', expiresAt: '2026-07-25' }] }, '2026-07-20T00:00:00.000Z').materials[0]
  assert.deepEqual({ freshOnHand: tonic.freshOnHand, trackFreshness: tonic.trackFreshness, remainingAmount: tonic.remainingAmount, remainingUnit: tonic.remainingUnit, expiresAt: tonic.expiresAt }, { freshOnHand: true, trackFreshness: false, remainingAmount: null, remainingUnit: null, expiresAt: null })
})

test('stale undo cannot overwrite newly added fresh inventory and repeated use-up is safe', () => {
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  const fruit = repository.saveMaterial({ name: '西瓜', category: 'fruit' })
  repository.addToFreshShelf(fruit.id, { remainingAmount: 500, remainingUnit: 'g' })
  const used = repository.useUpFreshMaterial(fruit.id)
  assert.deepEqual(repository.useUpFreshMaterial(fruit.id), { removed: false, undoToken: '' })
  repository.addToFreshShelf(fruit.id, { remainingAmount: 250, remainingUnit: 'g' })
  assert.equal(repository.restoreFreshMaterial(fruit.id, used.undoToken), null)
  assert.equal(repository.getMaterial(fruit.id).remainingAmount, 250)
})

test('stale undo cannot overwrite a material edit made after use-up', () => {
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  const fruit = repository.saveMaterial({ name: '西瓜', category: 'fruit' })
  repository.addToFreshShelf(fruit.id, { remainingAmount: 500, remainingUnit: 'g' })
  const used = repository.useUpFreshMaterial(fruit.id)
  repository.saveMaterial({ ...repository.getMaterial(fruit.id), name: '无籽西瓜' })
  assert.equal(repository.restoreFreshMaterial(fruit.id, used.undoToken), null)
  assert.equal(repository.getMaterial(fruit.id).name, '无籽西瓜')
})

test('all material writes roll back memory and storage when persistence fails', () => {
  let fail = false
  const adapter = memoryAdapter(undefined, () => fail)
  const repository = createRepository(adapter, repositoryOptions())
  repository.initialize()
  const fruit = repository.saveMaterial({ name: '西瓜', category: 'fruit' })
  const baseline = repository.getState()
  fail = true
  assert.throws(() => repository.addToFreshShelf(fruit.id, { remainingAmount: 1, remainingUnit: 'piece' }), /storage full/)
  assert.throws(() => repository.deleteMaterial(fruit.id), /storage full/)
  assert.deepEqual(repository.getState(), baseline)
  assert.deepEqual(adapter.read(), baseline)
})

test('material delete is protected by recipe references and otherwise truly deletes', () => {
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  const used = repository.saveMaterial({ name: '金酒', category: 'base-spirit' })
  const unused = repository.saveMaterial({ name: '迷迭香', category: 'other-solid' })
  repository.upsertRecipe({ name: 'Gin Sour', ingredients: [{ materialId: used.id, amount: 45, unit: 'ml' }] })
  assert.deepEqual(repository.deleteMaterial(used.id), { deleted: false, reason: 'referenced', usageCount: 1 })
  assert.deepEqual(repository.deleteMaterial(unused.id), { deleted: true, reason: '', usageCount: 0 })
  assert.equal(repository.getMaterial(unused.id), null)
})

test('library view model separates tracked fresh shelf and supports final filters and search', () => {
  const materials = [
    { id: 'watermelon', name: '西瓜', category: 'fruit', acquisition: 'on-demand', trackFreshness: true, freshOnHand: true, remainingAmount: 320, remainingUnit: 'g', expiresAt: '2026-07-22' },
    { id: 'tonic', name: '汤力水', category: 'soda/tonic', acquisition: 'on-demand', trackFreshness: false, freshOnHand: true },
    { id: 'gin', name: '金酒', category: 'base-spirit', acquisition: 'long-term', owned: true, trackFreshness: false },
    { id: 'violet', name: '紫罗兰利口酒', category: 'liqueur', acquisition: 'long-term', owned: false, trackFreshness: false },
    { id: 'milk', name: '牛奶', category: 'dairy/juice', acquisition: 'on-demand', trackFreshness: true, freshOnHand: false }
  ]
  const recipes = [
    { id: 'r1', ingredients: [{ materialId: 'watermelon' }, { materialId: 'gin' }] },
    { id: 'r2', ingredients: [{ materialId: 'violet' }, { materialId: 'gin' }] }
  ]
  const all = buildMaterialLibrary(materials, recipes, { now: '2026-07-20T00:00:00+08:00' })
  assert.deepEqual(all.freshShelf.map(({ id }) => id), ['watermelon'])
  assert.match(all.freshShelf.find(({ id }) => id === 'watermelon').inventoryLabel, /320g/)
  assert.equal(all.materials.find(({ id }) => id === 'tonic').isFreshShelf, false)
  assert.deepEqual(buildMaterialLibrary(materials, recipes, { filter: 'owned' }).materials.map(({ id }) => id).sort(), ['gin', 'tonic', 'watermelon'])
  assert.deepEqual(buildMaterialLibrary(materials, recipes, { filter: 'fresh' }).materials.map(({ id }) => id), ['watermelon'])
  assert.deepEqual(buildMaterialLibrary(materials, recipes, { filter: 'missing' }).materials.map(({ id }) => id).sort(), ['milk', 'violet'])
  assert.deepEqual(buildMaterialLibrary(materials, recipes, { search: '紫罗兰' }).materials.map(({ id }) => id), ['violet'])
  assert.equal(buildMaterialLibrary([{ id: 'raw', name: '旧西瓜', acquisition: 'on-demand', trackFreshness: true, freshOnHand: false, expiresAt: '2026-07-22' }], [], { now: '2026-07-21' }).materials[0].expiryLabel, '')
})

test('fresh shelf recommends usable recipes before rating and shorter preparation time', () => {
  const materials = [
    { id: 'fruit', name: '西瓜', category: 'fruit', acquisition: 'on-demand', trackFreshness: true, freshOnHand: true },
    { id: 'gin', name: '金酒', category: 'base-spirit', acquisition: 'long-term', owned: true, trackFreshness: false },
    { id: 'violet', name: '紫罗兰利口酒', category: 'liqueur', acquisition: 'long-term', owned: false, trackFreshness: false }
  ]
  const recipes = [
    { id: 'available-npc', name: '清爽西瓜', tried: true, rating: 'NPC', ingredients: [{ materialId: 'fruit' }, { materialId: 'gin' }], preparations: [{ type: '即调' }] },
    { id: 'missing-best', name: '紫罗兰西瓜', tried: true, rating: '夯', ingredients: [{ materialId: 'fruit' }, { materialId: 'violet' }], preparations: [{ type: '即调' }] },
    { id: 'available-best-long', name: '慢泡西瓜', tried: true, rating: '夯', ingredients: [{ materialId: 'fruit' }, { materialId: 'gin' }], preparations: [{ type: '冷泡/浸泡', durationText: '24小时' }] },
    { id: 'available-unrated', name: '随手西瓜', tried: false, ingredients: [{ materialId: 'fruit' }, { materialId: 'gin' }], preparations: [{ type: '即调' }] },
    { id: 'available-best-fast', name: '今晚西瓜', tried: true, rating: '夯', ingredients: [{ materialId: 'fruit' }, { materialId: 'gin' }], preparations: [{ type: '即调' }] }
  ]

  const fresh = buildMaterialLibrary(materials, recipes).freshShelf[0]

  assert.equal(fresh.recommendedRecipe.id, 'available-best-fast')
  assert.deepEqual(fresh.relatedRecipes.map(({ id }) => id), [
    'available-best-fast',
    'available-best-long',
    'available-npc',
    'available-unrated',
    'missing-best'
  ])
  assert.deepEqual(fresh.relatedRecipes.map(({ recommended }) => recommended), [true, false, false, false, false])
  assert.equal(fresh.relatedRecipes[1].preparationLabel, '冷泡/浸泡 · 提前24小时')
})

test('fresh shelf omits redundant on-hand copy and tolerates materials without recipes', () => {
  const noAmount = buildMaterialLibrary([
    { id: 'mint', name: '薄荷', category: 'other-solid', acquisition: 'on-demand', trackFreshness: true, freshOnHand: true }
  ], []).freshShelf[0]
  const tracked = buildMaterialLibrary([
    { id: 'lime', name: '青柠', category: 'citrus', acquisition: 'on-demand', trackFreshness: true, freshOnHand: true, remainingAmount: 2, remainingUnit: 'piece', expiresAt: '2026-07-28' }
  ], [], { now: '2026-07-26' }).freshShelf[0]

  assert.equal(noAmount.freshMeta, '')
  assert.equal(noAmount.recommendedRecipe, null)
  assert.deepEqual(noAmount.relatedRecipes, [])
  assert.equal(tracked.freshMeta, '还剩约 2个 · 2 天后到期')
})

test('fresh shelf shows purchase date and aggregates target use across serving and advance ingredients', () => {
  const materials = [
    { id: 'cucumber', name: '黄瓜', category: 'fruit', acquisition: 'on-demand', trackFreshness: true, freshOnHand: true, purchasedAt: '2026-07-26' }
  ]
  const recipes = [
    {
      id: 'combined', name: '黄瓜双用', tried: true, rating: '夯',
      ingredients: [
        { materialId: 'cucumber', amount: 20, unit: 'ml' },
        { materialId: 'cucumber', amount: 10, unit: 'ml' }
      ],
      advancePreparations: [
        { id: 'prep', ingredients: [{ materialId: 'cucumber', amount: 5, unit: 'ml' }] }
      ]
    },
    {
      id: 'mixed', name: '黄瓜拼配', tried: false,
      ingredients: [{ materialId: 'cucumber', amount: 30, unit: 'g' }],
      advancePreparations: [
        { id: 'prep', ingredients: [{ materialId: 'cucumber', amount: '半', unit: 'piece' }] }
      ]
    }
  ]

  const fresh = buildMaterialLibrary(materials, recipes).freshShelf[0]

  assert.equal(fresh.purchaseDateLabel, '07-26')
  assert.equal(fresh.relatedRecipes.find(({ id }) => id === 'combined').materialAmountLabel, '35ml')
  assert.equal(fresh.relatedRecipes.find(({ id }) => id === 'mixed').materialAmountLabel, '30g + 半个')
})

test('complete catalog merges templates with real materials and filters by the eight approved tabs', () => {
  assert.deepEqual(MATERIAL_LIBRARY_TABS.map(({ key, label }) => ({ key, label })), [
    { key: 'all', label: '全部' },
    { key: 'base', label: '基酒' },
    { key: 'liqueur', label: '利口酒' },
    { key: 'syrup', label: '糖浆' },
    { key: 'produce', label: '果汁/果蔬' },
    { key: 'mixer', label: '混合饮品' },
    { key: 'spice', label: '香料' },
    { key: 'other', label: '其他' }
  ])
  const materials = [
    { id: 'gin-real', name: '金酒', category: 'base-spirit', acquisition: 'long-term', owned: true, trackFreshness: false },
    { id: 'mint', name: '薄荷', category: 'other-solid', acquisition: 'on-demand', freshOnHand: false, trackFreshness: false },
    { id: 'mystery', name: '神秘材料', category: 'other', acquisition: 'on-demand', freshOnHand: false, trackFreshness: false }
  ]
  const base = buildMaterialLibrary(materials, [], { includeCatalog: true, categoryFilter: 'base' }).materials
  assert.deepEqual(base.map(({ name }) => name), ['金酒', '白朗姆', '伏特加'])
  assert.deepEqual({ id: base[0].id, template: base[0].isTemplate, state: base[0].visualState, label: base[0].categoryLabel }, { id: 'gin-real', template: false, state: 'owned', label: '基酒' })
  assert.deepEqual({ id: base[1].id, template: base[1].isTemplate, state: base[1].visualState }, { id: '', template: true, state: 'missing-long-term' })
  assert.equal(new Set(base.map(({ renderKey }) => renderKey)).size, base.length)
  assert.deepEqual(buildMaterialLibrary(materials, [], { includeCatalog: true, categoryFilter: 'liqueur' }).materials.map(({ name }) => name), [])
  assert.deepEqual(buildMaterialLibrary(materials, [], { includeCatalog: true, categoryFilter: 'syrup' }).materials.map(({ name }) => name), ['普通糖浆', '接骨木糖浆'])
  assert.deepEqual(buildMaterialLibrary(materials, [], { includeCatalog: true, categoryFilter: 'spice' }).materials.map(({ name }) => name), ['薄荷'])
  assert.deepEqual(buildMaterialLibrary(materials, [], { includeCatalog: true, categoryFilter: 'other' }).materials.map(({ name }) => name), ['神秘材料'])
  assert.deepEqual(buildMaterialLibrary(materials, [], { includeCatalog: true, search: '接骨木' }).materials.map(({ name }) => name), ['接骨木糖浆'])
  assert.deepEqual(buildMaterialLibrary(materials, [], { includeCatalog: true, search: '朗姆' }).materials.map(({ name }) => name), ['白朗姆'])
  assert.deepEqual(buildMaterialLibrary(materials, [], { includeCatalog: true, search: '单糖浆' }).materials.map(({ name }) => name), ['普通糖浆'])
})

test('every material library card resolves to a persisted material detail target', () => {
  assert.equal(typeof ensureLibraryMaterial, 'function')
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  const existing = repository.saveMaterial({ name: '西瓜', category: 'fruit' })
  assert.equal(ensureLibraryMaterial(repository, existing).id, existing.id)
  const template = ensureLibraryMaterial(repository, { id: '', name: '金酒', category: 'base-spirit', isTemplate: true })
  assert.ok(template.id)
  assert.equal(template.name, '金酒')
  assert.equal(template.category, 'base-spirit')
  assert.equal(template.owned, false)
  assert.equal(template.assumedAvailable, false)
  assert.equal(repository.listMaterials().length, 2)
})

test('fresh material form state never sends undefined fields to the rendering layer', () => {
  assert.equal(typeof buildFreshFormState, 'function')
  const state = buildFreshFormState({ id: 'watermelon', name: '西瓜', trackFreshness: true, defaultUnit: 'g' })
  assert.deepEqual(state, {
    showFreshForm: true,
    freshError: '',
    freshUnitIndex: 1,
    freshDraft: { materialId: 'watermelon', name: '西瓜', trackFreshness: true, remainingAmount: '', remainingUnit: 'g', expiresAt: '' }
  })
  assert.doesNotMatch(JSON.stringify(state), /undefined/)
})

test('material library puts available cards first while preserving catalog order within each state', () => {
  const materials = [
    { id: 'gin', name: '金酒', category: 'base-spirit', acquisition: 'long-term', owned: false, trackFreshness: false },
    { id: 'rum', name: '白朗姆', category: 'base-spirit', acquisition: 'long-term', owned: true, trackFreshness: false },
    { id: 'vodka', name: '伏特加', category: 'base-spirit', acquisition: 'long-term', owned: true, trackFreshness: false }
  ]
  const cards = buildMaterialLibrary(materials, [], { includeCatalog: true, categoryFilter: 'base' }).materials
  assert.deepEqual(cards.map(({ name }) => name), ['白朗姆', '伏特加', '金酒'])
  assert.deepEqual(cards.map(({ visualState }) => visualState), ['owned', 'owned', 'missing-long-term'])
})

test('material library sorts a category by availability then usage count', () => {
  const materials = [
    { id: 'gin', name: '金酒', category: 'base-spirit', acquisition: 'long-term', owned: true, trackFreshness: false },
    { id: 'rum', name: '白朗姆', category: 'base-spirit', acquisition: 'long-term', owned: true, trackFreshness: false },
    { id: 'vodka', name: '伏特加', category: 'base-spirit', acquisition: 'long-term', owned: false, trackFreshness: false },
    { id: 'tequila', name: '龙舌兰', category: 'base-spirit', acquisition: 'long-term', owned: false, trackFreshness: false }
  ]
  const recipes = [
    { id: 'r1', ingredients: [{ materialId: 'rum' }, { materialId: 'vodka' }] },
    { id: 'r2', ingredients: [{ materialId: 'rum' }, { materialId: 'vodka' }] },
    { id: 'r3', ingredients: [{ materialId: 'gin' }, { materialId: 'vodka' }] },
    { id: 'r4', ingredients: [{ materialId: 'tequila' }] }
  ]

  const cards = buildMaterialLibrary(materials, recipes, { includeCatalog: true, categoryFilter: 'base' }).materials
  assert.deepEqual(cards.map(({ id }) => id), ['rum', 'gin', 'vodka', 'tequila'])
  assert.deepEqual(cards.map(({ usageCount }) => usageCount), [2, 1, 3, 1])
})

test('all materials put available cards first and preserve category order inside each availability group', () => {
  const materials = [
    { id: 'gin', name: '金酒', category: 'base-spirit', acquisition: 'long-term', owned: true, trackFreshness: false },
    { id: 'violet', name: '紫罗兰利口酒', category: 'liqueur', acquisition: 'long-term', owned: false, trackFreshness: false },
    { id: 'ordinary', name: '普通糖浆', category: 'syrup/staple', acquisition: 'long-term', owned: true, trackFreshness: false },
    { id: 'lemon', name: '柠檬汁', category: 'citrus', acquisition: 'long-term', owned: true, trackFreshness: false }
  ]
  const recipes = Array.from({ length: 5 }, (_, index) => ({ id: `lemon-${index}`, ingredients: [{ materialId: 'lemon' }] }))

  const cards = buildMaterialLibrary(materials, recipes, { includeCatalog: true, categoryFilter: 'all' }).materials
  const firstMissing = cards.findIndex(({ visualState }) => visualState !== 'owned')
  assert.ok(cards.slice(0, firstMissing).every(({ visualState }) => visualState === 'owned'))
  assert.deepEqual(cards.slice(0, firstMissing).map(({ categoryFilter }) => categoryFilter), ['base', 'syrup', 'produce'])
  assert.ok(cards.findIndex(({ id }) => id === 'gin') < cards.findIndex(({ id }) => id === 'ordinary'))
  assert.ok(cards.findIndex(({ id }) => id === 'ordinary') < cards.findIndex(({ id }) => id === 'lemon'))
})

test('bar glassware cards combine name and capacity and blank names receive the next local sequence', () => {
  const glasses = [
    { id: 'g1', name: '酒杯1', capacityMl: 300 },
    { id: 'g2', name: '柯林杯', capacityMl: 420 }
  ]
  assert.deepEqual(buildGlasswareCards(glasses).map(({ displayLabel }) => displayLabel), ['酒杯1-300ml', '柯林杯-420ml'])
  assert.deepEqual(prepareGlasswareForSave({ name: '  ', capacityMl: '260' }, glasses), { name: '酒杯2', capacityMl: '260' })
  assert.equal(prepareGlasswareForSave({ name: ' 高球杯 ', capacityMl: 350 }, glasses).name, '高球杯')
})

test('fresh inventory label distinguishes absent amounts from a real zero', () => {
  for (const remainingAmount of [null, undefined, '']) {
    assert.equal(formatInventory({ freshOnHand: true, trackFreshness: true, remainingAmount, remainingUnit: 'g' }), '当前在手头')
  }
  assert.equal(formatInventory({ freshOnHand: true, trackFreshness: true, remainingAmount: 0, remainingUnit: 'g' }), '还剩约 0g')
})

test('adding fresh material without amount produces a normal on-hand card', () => {
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  const fruit = repository.saveMaterial({ name: '西瓜', category: 'fruit' })
  repository.addToFreshShelf(fruit.id)
  const view = buildMaterialLibrary(repository.listMaterials(), repository.listRecipes())
  assert.equal(view.freshShelf.length, 1)
  assert.equal(view.freshShelf[0].inventoryLabel, '当前在手头')
  assert.equal(view.materials[0].inventoryLabel, '当前在手头')
})

test('expiry labels compare local calendar ordinals rather than elapsed hours', () => {
  const shanghaiNow = '2026-07-20T23:30:00+08:00'
  for (const empty of [null, undefined, '']) assert.equal(formatExpiry(empty, shanghaiNow, 480), '')
  assert.equal(formatExpiry('2026-07-19', shanghaiNow, 480), '已过期 1 天')
  assert.equal(formatExpiry('2026-07-20', shanghaiNow, 480), '今天到期')
  assert.equal(formatExpiry('2026-07-22', shanghaiNow, 480), '2 天后到期')
  assert.equal(getLocalDateOrdinal('2026-03-08', -300) + 1, getLocalDateOrdinal('2026-03-09', -240))
  assert.equal(formatExpiry('2026-03-09', '2026-03-08T23:30:00-04:00', -240), '1 天后到期')
})

test('library cards show usage and immediate unlock counts', () => {
  const materials = [
    { id: 'target', name: '紫罗兰利口酒', acquisition: 'long-term', owned: false, trackFreshness: false },
    { id: 'gin', name: '金酒', acquisition: 'long-term', owned: true, trackFreshness: false },
    { id: 'other', name: '另一瓶', acquisition: 'long-term', owned: false, trackFreshness: false }
  ]
  const recipes = [
    { id: 'one', ingredients: [{ materialId: 'target' }, { materialId: 'gin' }] },
    { id: 'two', ingredients: [{ materialId: 'target' }, { materialId: 'other' }] }
  ]
  const card = buildMaterialLibrary(materials, recipes).materials.find(({ id }) => id === 'target')
  assert.equal(card.usageCount, 2)
  assert.equal(card.immediateUnlockCount, 1)
})

test('available materials may keep an optional purchase date while tracked stock defaults to today', () => {
  let id = 0
  const repository = createRepository(memoryAdapter(), {
    idFactory: () => `purchase-${++id}`,
    now: () => '2026-07-21T09:30:00.000Z'
  })
  repository.initialize()
  const gin = repository.saveMaterial({ name: '金酒', category: 'base-spirit', owned: true, trackFreshness: false, purchasedAt: '2026-07-01' })
  assert.equal(gin.purchasedAt, '2026-07-01')
  assert.equal(repository.setMaterialOwned(gin.id, false).purchasedAt, null)

  const tonic = repository.saveMaterial({ name: '苏打水', category: 'soda/tonic', trackFreshness: false })
  assert.equal(repository.addToFreshShelf(tonic.id, { purchasedAt: '2026-07-03' }).purchasedAt, '2026-07-03')

  const watermelon = repository.saveMaterial({ name: '西瓜', category: 'fruit', trackFreshness: true })
  const stocked = repository.addToFreshShelf(watermelon.id)
  assert.equal(stocked.purchasedAt, '2026-07-21')
  repository.useUpFreshMaterial(watermelon.id)
  assert.equal(repository.getMaterial(watermelon.id).purchasedAt, null)

  const milk = repository.saveMaterial({ name: '牛奶', category: 'dairy/juice', trackFreshness: true })
  assert.equal(repository.saveMaterial({ ...milk, freshOnHand: true }).purchasedAt, '2026-07-21')

  const staleFruit = repository.saveMaterial({ name: '草莓', category: 'fruit', trackFreshness: true, purchasedAt: '2025-01-01' })
  assert.equal(repository.saveMaterial({ ...staleFruit, freshOnHand: true }).purchasedAt, '2026-07-21')
  assert.equal(repository.setMaterialPurchasedAt(staleFruit.id, '2026-07-19').purchasedAt, '2026-07-19')
})

test('material purchase date can be edited or cleared atomically', () => {
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  const gin = repository.saveMaterial({ name: '金酒', category: 'base-spirit', owned: true })
  assert.equal(repository.setMaterialPurchasedAt(gin.id, '2026-07-18').purchasedAt, '2026-07-18')
  const baseline = repository.getState()
  assert.throws(() => repository.setMaterialPurchasedAt(gin.id, 'not-a-date'), /Invalid material date/)
  assert.deepEqual(repository.getState(), baseline)
  assert.equal(repository.setMaterialPurchasedAt(gin.id, null).purchasedAt, null)
})

test('material detail keeps summary statistics and observations without hydrating recipe cards', () => {
  const materials = [
    { id: 'watermelon', name: '西瓜', acquisition: 'on-demand', freshOnHand: true, trackFreshness: true, remainingAmount: 300, remainingUnit: 'g', purchasedAt: '2026-07-20', expiresAt: null },
    { id: 'gin', name: '金酒', acquisition: 'long-term', owned: true, trackFreshness: false }
  ]
  const recipes = [{
    id: 'r1', name: '西瓜金酒酸', imagePath: '/images/watermelon.jpg', preparations: [{ type: '即调' }],
    ingredients: [{ materialId: 'watermelon', amount: 100, unit: 'g' }, { materialId: 'gin', amount: 45, unit: 'ml' }],
    glasswareId: 'g1', toolIds: ['t1'],
    materialObservations: [{ materialId: 'watermelon', note: '冰一点更好', createdAt: '2026-07-20T00:00:00.000Z' }]
  }]
  const detail = buildMaterialDetail(materials[0], { materials, recipes, now: '2026-07-21T00:00:00+08:00' })
  assert.equal(detail.status, 'ok')
  assert.equal(detail.usageCount, 1)
  assert.equal(detail.purchasedAtDate, '2026-07-20')
  assert.equal(detail.canEditPurchasedAt, true)
  assert.equal(detail.expiryLabel, '')
  assert.equal(Object.hasOwn(detail, 'relatedRecipes'), false)
  assert.equal(detail.observations[0].note, '冰一点更好')
})

test('material detail exposes one availability switch and optional tracking for every acquisition type', () => {
  const trackedGin = buildMaterialDetail({
    id: 'gin', name: '金酒', acquisition: 'long-term', owned: true, freshOnHand: false,
    trackFreshness: true, remainingAmount: 300, remainingUnit: 'ml', purchasedAt: '2026-07-20'
  })
  assert.deepEqual({ available: trackedGin.available, canToggleAvailable: trackedGin.canToggleAvailable, canToggleTracking: trackedGin.canToggleTracking, canEditTracking: trackedGin.canEditTracking }, {
    available: true, canToggleAvailable: true, canToggleTracking: true, canEditTracking: true
  })
  const missingFruit = buildMaterialDetail({ id: 'fruit', name: '西瓜', acquisition: 'on-demand', owned: false, freshOnHand: false, trackFreshness: true })
  assert.deepEqual({ available: missingFruit.available, canToggleAvailable: missingFruit.canToggleAvailable, canToggleTracking: missingFruit.canToggleTracking, canEditTracking: missingFruit.canEditTracking }, {
    available: false, canToggleAvailable: true, canToggleTracking: false, canEditTracking: false
  })
  const untrackedTonic = buildMaterialDetail({ id: 'tonic', name: '汤力水', acquisition: 'on-demand', freshOnHand: true, trackFreshness: false })
  assert.equal(untrackedTonic.inventoryLabel, '')
})

test('material detail appends multiple direct observations and validates empty notes', () => {
  const repository = createRepository(memoryAdapter(), repositoryOptions())
  repository.initialize()
  const cucumber = repository.saveMaterial({ name: '黄瓜', category: 'fruit' })

  assert.deepEqual(validateMaterialObservation('   '), { valid: false, message: '请填写材料观察' })
  assert.equal(orchestrateMaterialObservationSave({ repository, materialId: cucumber.id, note: '清香', notify() {} }).saved, true)
  assert.equal(orchestrateMaterialObservationSave({ repository, materialId: cucumber.id, note: '适合搭配金酒', notify() {} }).saved, true)
  assert.deepEqual(repository.getMaterial(cucumber.id).observations.map(({ note }) => note), ['清香', '适合搭配金酒'])

  const detail = buildMaterialDetail(repository.getMaterial(cucumber.id), { materials: repository.listMaterials(), recipes: [] })
  assert.deepEqual(detail.observations.map(({ note, direct }) => ({ note, direct })), [
    { note: '适合搭配金酒', direct: true },
    { note: '清香', direct: true }
  ])
})

test('material detail only exposes purchase-date editing while the material is currently available', () => {
  const missingLongTerm = buildMaterialDetail({ id: 'gin', name: '金酒', acquisition: 'long-term', owned: false, trackFreshness: false, purchasedAt: '2026-07-01' })
  const missingFresh = buildMaterialDetail({ id: 'watermelon', name: '西瓜', acquisition: 'on-demand', freshOnHand: false, trackFreshness: true, purchasedAt: null })
  assert.equal(missingLongTerm.canEditPurchasedAt, false)
  assert.equal(missingFresh.canEditPurchasedAt, false)
  assert.equal(missingFresh.purchasedAtDate, '')
  assert.equal(buildMaterialDetail({ id: 'invalid-date', name: '金酒', acquisition: 'long-term', owned: true, trackFreshness: false, purchasedAt: '2026-02-28junk' }).purchasedAtDate, '')
  const legacyTimestamp = '2026-07-20T18:30:00.000Z'
  const legacyDetail = buildMaterialDetail({ id: 'legacy', name: '西瓜', acquisition: 'on-demand', freshOnHand: true, trackFreshness: true, purchasedAt: legacyTimestamp })
  const local = new Date(legacyTimestamp)
  const pad = (part) => String(part).padStart(2, '0')
  assert.equal(legacyDetail.purchasedAtDate, `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`)
})

test('fresh use-up controller exposes a real undo action and handles failures', () => {
  const calls = []
  const repository = {
    useUpFreshMaterial: () => ({ removed: true, undoToken: 'undo-1' }),
    restoreFreshMaterial: (_, token) => token === 'undo-1' ? { id: 'm1' } : null
  }
  const used = orchestrateFreshUseUp({ repository, materialId: 'm1', notify: (message) => calls.push(message) })
  assert.deepEqual(used, { removed: true, materialId: 'm1', undoToken: 'undo-1' })
  assert.equal(orchestrateFreshUndo({ repository, undo: used, notify: (message) => calls.push(message) }).restored, true)
  assert.deepEqual(calls, ['已从手头鲜材移出', '已撤销'])
  assert.equal(orchestrateFreshUseUp({ repository: { useUpFreshMaterial() { throw new Error('x') } }, materialId: 'm1', notify: (message) => calls.push(message) }).removed, false)
})

test('material form validation normalizes all fields and allows missing alcoholic ABV', () => {
  assert.deepEqual(validateMaterialForm({
    name: ' 紫罗兰利口酒 ', category: 'liqueur', acquisition: 'long-term', form: 'liquid', defaultUnit: 'ml',
    alcoholic: true, abv: '20', trackFreshness: false, owned: true
  }), {
    valid: true,
    value: { name: '紫罗兰利口酒', category: 'liqueur', acquisition: 'long-term', form: 'liquid', defaultUnit: 'ml', alcoholic: true, abv: 20, trackFreshness: false, assumedAvailable: false, owned: true, freshOnHand: false, remainingAmount: null, remainingUnit: null, purchasedAt: null, expiresAt: null },
    errors: {}
  })
  assert.equal(validateMaterialForm({ name: '利口酒', category: 'liqueur', acquisition: 'long-term', form: 'liquid', defaultUnit: 'ml', alcoholic: true, abv: '' }).valid, true)
  assert.equal(validateMaterialForm({ name: '', category: 'fruit', acquisition: 'on-demand', form: 'solid', defaultUnit: 'g', alcoholic: false }).errors.name, '请填写材料名称')
  assert.equal(validateMaterialForm({ name: '酒', category: 'liqueur', acquisition: 'long-term', form: 'liquid', defaultUnit: 'ml', alcoholic: true, abv: 'nope' }).errors.abv, '酒精度需大于 0 且不超过 100')
  assert.equal(validateMaterialForm({ name: '西瓜', category: 'fruit', acquisition: 'teleport', form: 'solid', defaultUnit: 'g', alcoholic: false }).errors.acquisition, '请选择获取方式')
  const onHandUntracked = validateMaterialForm({ name: '汤力水', category: 'soda/tonic', acquisition: 'on-demand', form: 'liquid', defaultUnit: 'top-up', alcoholic: false, freshOnHand: true, trackFreshness: false, remainingAmount: '2', remainingUnit: 'piece', expiresAt: '2026-07-25' })
  assert.deepEqual({ freshOnHand: onHandUntracked.value.freshOnHand, trackFreshness: onHandUntracked.value.trackFreshness, remainingAmount: onHandUntracked.value.remainingAmount, remainingUnit: onHandUntracked.value.remainingUnit, expiresAt: onHandUntracked.value.expiresAt }, { freshOnHand: true, trackFreshness: false, remainingAmount: null, remainingUnit: null, expiresAt: null })
  assert.equal(validateMaterialForm({ name: '汤力水', category: 'soda/tonic', acquisition: 'on-demand', form: 'liquid', defaultUnit: 'top-up', alcoholic: false, freshOnHand: true, trackFreshness: false, purchasedAt: '2026-07-18' }).value.purchasedAt, '2026-07-18')
  const trackedSpirit = validateMaterialForm({ name: '金酒', category: 'base-spirit', acquisition: 'long-term', form: 'liquid', defaultUnit: 'ml', alcoholic: true, abv: '40', owned: true, trackFreshness: true, remainingAmount: '350', remainingUnit: 'ml', purchasedAt: '2026-07-18', expiresAt: '2027-07-18' })
  assert.deepEqual({ owned: trackedSpirit.value.owned, remainingAmount: trackedSpirit.value.remainingAmount, remainingUnit: trackedSpirit.value.remainingUnit, purchasedAt: trackedSpirit.value.purchasedAt, expiresAt: trackedSpirit.value.expiresAt }, { owned: true, remainingAmount: 350, remainingUnit: 'ml', purchasedAt: '2026-07-18', expiresAt: '2027-07-18' })
  const explicitMissingStaple = validateMaterialForm({ name: '柠檬汁', category: 'citrus', acquisition: 'long-term', form: 'liquid', defaultUnit: 'ml', alcoholic: false, owned: false, assumedAvailable: true, trackFreshness: false })
  assert.deepEqual({ owned: explicitMissingStaple.value.owned, assumedAvailable: explicitMissingStaple.value.assumedAvailable }, { owned: false, assumedAvailable: false })
})

test('material save orchestration returns inline errors and never navigates after repository failure', () => {
  const form = {
    name: '西瓜', category: 'fruit', acquisition: 'on-demand', form: 'solid', defaultUnit: 'g',
    alcoholic: false, freshOnHand: false, trackFreshness: true
  }
  const messages = []
  let navigations = 0
  const failed = orchestrateMaterialSave({
    repository: { saveMaterial() { throw new Error('storage full') } },
    form,
    notify: (message) => messages.push(message),
    navigate: () => { navigations++ }
  })
  assert.equal(failed.saved, false)
  assert.equal(failed.errors.form, '保存失败，请重试')
  assert.equal(failed.form.name, '西瓜')
  assert.equal(navigations, 0)
  assert.deepEqual(messages, ['保存失败，请重试'])

  const duplicate = orchestrateMaterialSave({
    repository: { saveMaterial() { throw new Error('Material already exists') } },
    form,
    notify: () => {},
    navigate: () => { navigations++ }
  })
  assert.equal(duplicate.errors.name, '同一分类下已经有这个材料')
  assert.equal(navigations, 0)
})

test('saving an existing material returns to its previous page without stacking another detail page', () => {
  assert.equal(typeof materialSaveNavigation, 'function')
  assert.deepEqual(materialSaveNavigation('edit', 'watermelon/fresh'), { action: 'back' })
  assert.deepEqual(materialSaveNavigation('create', 'watermelon/fresh'), {
    action: 'redirect',
    url: '/pages/material-detail/index?id=watermelon%2Ffresh'
  })
})

test('route decoding rejects malformed material IDs', () => {
  assert.equal(decodeMaterialId('watermelon%2Ffresh'), 'watermelon/fresh')
  assert.equal(decodeMaterialId('%E0%A4%A'), '')
  assert.equal(decodeMaterialId(), '')
})

test('mini program registers material detail and editor with actionable fresh undo UI', () => {
  const app = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'))
  assert.ok(app.pages.includes('pages/material-detail/index'))
  assert.ok(app.pages.includes('pages/material-edit/index'))
  for (const page of ['material-detail', 'material-edit']) {
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert.equal(fs.existsSync(`miniprogram/pages/${page}/index.${extension}`), true)
    }
  }
  const materialsWxml = fs.readFileSync('miniprogram/pages/materials/index.wxml', 'utf8')
  assert.match(materialsWxml, /bindtap="onUndoUseUp"/)
  assert.match(materialsWxml, /data-id="\{\{item.id\}\}"/)
  assert.match(materialsWxml, /手头鲜材/)
  assert.match(materialsWxml, /未有材料/)
  assert.match(materialsWxml, /class="catalog-tabs"/)
  const detailWxml = fs.readFileSync('miniprogram/pages/material-detail/index.wxml', 'utf8')
  assert.match(detailWxml, /bindchange="onPurchaseDateChange"/)
  assert.match(detailWxml, /class="purchase-label">购买日期<\/text>/)
  assert.doesNotMatch(detailWxml, /购买日期（选填）/)
  assert.match(detailWxml, /class="purchase-actions"[\s\S]*?class="purchase-clear"[\s\S]*?<picker[^>]*bindchange="onPurchaseDateChange"/)
  const detailCss = fs.readFileSync('miniprogram/pages/material-detail/index.wxss', 'utf8')
  assert.match(detailCss, /\.purchase-actions\s*\{[^}]*margin-left:\s*auto[^}]*justify-content:\s*flex-end/)
  assert.match(detailCss, /\.purchase-value\s*\{[^}]*text-align:\s*right/)
  assert.match(detailCss, /\.purchase-clear\.purchase-clear\s*\{[^}]*min-height:\s*36rpx[^}]*line-height:\s*36rpx[^}]*padding:\s*0 4rpx/)
  assert.doesNotMatch(detailWxml, /还能做什么/)
})
