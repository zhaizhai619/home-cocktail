const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { STORAGE_KEY, migrateState } = require('../miniprogram/services/schema')
const { createRepository } = require('../miniprogram/services/repository')
const {
  buildMaterialLibrary,
  orchestrateFreshUseUp,
  orchestrateFreshUndo
} = require('../miniprogram/pages/materials/model')
const {
  buildMaterialDetail,
  decodeMaterialId
} = require('../miniprogram/pages/material-detail/model')
const { validateMaterialForm } = require('../miniprogram/pages/material-edit/model')

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
    { name: 'X', category: 'fruit', freshOnHand: true, expiresAt: 'not-a-date' }
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
  assert.deepEqual(all.freshShelf.map(({ id }) => id).sort(), ['tonic', 'watermelon'])
  assert.match(all.freshShelf.find(({ id }) => id === 'watermelon').inventoryLabel, /320g/)
  assert.equal(all.freshShelf.find(({ id }) => id === 'tonic').inventoryLabel, '当前在手头')
  assert.deepEqual(buildMaterialLibrary(materials, recipes, { filter: 'owned' }).materials.map(({ id }) => id).sort(), ['gin', 'tonic', 'watermelon'])
  assert.deepEqual(buildMaterialLibrary(materials, recipes, { filter: 'fresh' }).materials.map(({ id }) => id).sort(), ['tonic', 'watermelon'])
  assert.deepEqual(buildMaterialLibrary(materials, recipes, { filter: 'missing' }).materials.map(({ id }) => id).sort(), ['milk', 'violet'])
  assert.deepEqual(buildMaterialLibrary(materials, recipes, { search: '紫罗兰' }).materials.map(({ id }) => id), ['violet'])
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

test('material detail hydrates related recipes with full ingredient, glassware, tool and observations', () => {
  const materials = [
    { id: 'watermelon', name: '西瓜', acquisition: 'on-demand', freshOnHand: true, trackFreshness: true, remainingAmount: 300, remainingUnit: 'g' },
    { id: 'gin', name: '金酒', acquisition: 'long-term', owned: true, trackFreshness: false }
  ]
  const recipes = [{
    id: 'r1', name: '西瓜金酒酸', imagePath: '/images/watermelon.jpg', preparations: [{ type: '即调' }],
    ingredients: [{ materialId: 'watermelon', amount: 100, unit: 'g' }, { materialId: 'gin', amount: 45, unit: 'ml' }],
    glasswareId: 'g1', toolIds: ['t1'],
    materialObservations: [{ materialId: 'watermelon', note: '冰一点更好', createdAt: '2026-07-20T00:00:00.000Z' }]
  }]
  const detail = buildMaterialDetail(materials[0], { materials, recipes, glassware: [{ id: 'g1', name: '古典杯', capacity: 300 }], tools: [{ id: 't1', name: '摇酒壶' }] })
  assert.equal(detail.status, 'ok')
  assert.equal(detail.relatedRecipes[0].ingredients.length, 2)
  assert.equal(detail.relatedRecipes[0].glasswareLabel, '古典杯 · 300ml')
  assert.equal(detail.relatedRecipes[0].toolsLabel, '摇酒壶')
  assert.equal(detail.relatedRecipes[0].imagePath, '/images/watermelon.jpg')
  assert.equal(detail.observations[0].note, '冰一点更好')
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
  const onHandUntracked = validateMaterialForm({ name: '汤力水', category: 'soda/tonic', acquisition: 'on-demand', form: 'liquid', defaultUnit: 'top-up', alcoholic: false, freshOnHand: true, trackFreshness: false, remainingAmount: '2', remainingUnit: 'piece', expiresAt: '2026-07-25' })
  assert.deepEqual({ freshOnHand: onHandUntracked.value.freshOnHand, trackFreshness: onHandUntracked.value.trackFreshness, remainingAmount: onHandUntracked.value.remainingAmount, remainingUnit: onHandUntracked.value.remainingUnit, expiresAt: onHandUntracked.value.expiresAt }, { freshOnHand: true, trackFreshness: false, remainingAmount: null, remainingUnit: null, expiresAt: null })
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
  assert.match(materialsWxml, /我没有/)
  const detailWxml = fs.readFileSync('miniprogram/pages/material-detail/index.wxml', 'utf8')
  assert.match(detailWxml, /wx:if="\{\{item.imagePath\}\}"/)
  assert.match(detailWxml, /src="\{\{item.imagePath\}\}"/)
})
