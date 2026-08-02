const assert = require('node:assert/strict')
const test = require('node:test')

const { createRepository } = require('../miniprogram/services/repository')
const { filterAndSortRecipeCards } = require('../miniprogram/pages/recipes/model')
const { buildRecipeDetail } = require('../miniprogram/pages/recipe-detail/model')
const { orchestrateFreshUseUp, orchestrateFreshUndo } = require('../miniprogram/pages/materials/model')

function fixture() {
  let id = 0
  let stored
  const adapter = {
    get() { return stored && structuredClone(stored) },
    set(_key, value) { stored = structuredClone(value) }
  }
  const repository = createRepository(adapter, {
    idFactory: () => `flow-${++id}`,
    now: () => '2026-07-20T12:00:00.000Z'
  })
  repository.initialize()
  return repository
}

function byId(items) {
  return Object.fromEntries(items.map((item) => [item.id, item]))
}

test('personal recipe flow links generated materials, readiness, detail, observations, fresh undo and glass capacity', () => {
  const repository = fixture()
  const glass = repository.upsertGlassware({ name: '海波杯', capacityMl: 200 })
  const recipe = repository.saveRecipeWithMaterials({
    name: '冷冻西瓜金酒酸',
    tried: true,
    ingredients: [
      { draftKey: 'gin', amount: 40, unit: 'ml' },
      { draftKey: 'watermelon', amount: 100, unit: 'ml' },
      { draftKey: 'violet', amount: 10, unit: 'ml' }
    ],
    preparations: [{ type: '冷冻', amount: 1, unit: 'day' }],
    glasswareId: glass.id,
    toolIds: []
  }, [
    { draftKey: 'gin', name: '金酒', category: 'base-spirit', acquisition: 'long-term', form: 'liquid', defaultUnit: 'ml', alcoholic: true, abv: 40, owned: true, freshOnHand: false, trackFreshness: false, assumedAvailable: false },
    { draftKey: 'watermelon', name: '西瓜', category: 'fruit', acquisition: 'on-demand', form: 'solid', defaultUnit: 'ml', alcoholic: false, abv: null, owned: false, freshOnHand: false, trackFreshness: true, assumedAvailable: false },
    { draftKey: 'violet', name: '紫罗兰利口酒', category: 'liqueur', acquisition: 'long-term', form: 'liquid', defaultUnit: 'ml', alcoholic: true, abv: 20, owned: false, freshOnHand: false, trackFreshness: false, assumedAvailable: false }
  ])

  const generated = repository.listMaterials()
  assert.deepEqual(generated.map(({ name }) => name), ['金酒', '西瓜', '紫罗兰利口酒'])
  let materials = byId(generated)
  assert.deepEqual(filterAndSortRecipeCards(repository.listRecipes(), materials, { prepType: '冷冻', materialCondition: 'all' }).map(({ id }) => id), [recipe.id])
  assert.deepEqual(filterAndSortRecipeCards(repository.listRecipes(), materials, { materialCondition: 'on-hand' }), [])
  assert.deepEqual(filterAndSortRecipeCards(repository.listRecipes(), materials, { materialCondition: 'fresh-only' }), [])

  const violet = generated.find(({ name }) => name === '紫罗兰利口酒')
  repository.setMaterialOwned(violet.id, true)
  materials = byId(repository.listMaterials())
  assert.deepEqual(filterAndSortRecipeCards(repository.listRecipes(), materials, { materialCondition: 'fresh-only' }).map(({ id }) => id), [recipe.id])

  const watermelon = generated.find(({ name }) => name === '西瓜')
  repository.addToFreshShelf(watermelon.id, { remainingAmount: 500, remainingUnit: 'g', expiresAt: '2026-07-23' })
  materials = byId(repository.listMaterials())
  assert.deepEqual(filterAndSortRecipeCards(repository.listRecipes(), materials, { materialCondition: 'on-hand' }).map(({ id }) => id), [recipe.id])

  repository.appendRecipeObservation(recipe.id, { materialId: watermelon.id, note: '冰镇后甜感更干净' })
  const detail = buildRecipeDetail(repository.getRecipe(recipe.id), repository.listMaterials(), repository.listGlassware(), repository.listTools())
  assert.equal(detail.observations[0].note, '冰镇后甜感更干净')
  assert.equal(detail.glassware.name, '海波杯')
  assert.equal(detail.capacity.liquidVolume, 150)
  assert.equal(detail.capacity.status, 'under')

  const undo = orchestrateFreshUseUp({ repository, materialId: watermelon.id })
  assert.equal(repository.getMaterial(watermelon.id).freshOnHand, false)
  assert.ok(repository.getRecipe(recipe.id))
  assert.equal(orchestrateFreshUndo({ repository, undo }).restored, true)
  assert.equal(repository.getMaterial(watermelon.id).freshOnHand, true)
})
