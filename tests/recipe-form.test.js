const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createEmptyRecipeForm,
  applyQuickBase,
  replaceIngredientName,
  createIngredientDraft,
  normalizeAndValidateForm,
  buildRecipePayload,
  getFormPreview
} = require('../miniprogram/pages/recipe-edit/model')

test('empty recipe form includes the fast-entry defaults', () => {
  const form = createEmptyRecipeForm()
  assert.deepEqual(form.ingredients.map(({ name, unit, amount }) => ({ name, unit, amount })), [
    { name: '柠檬汁', unit: 'ml', amount: '' },
    { name: '糖浆', unit: 'ml', amount: '' }
  ])
  assert.deepEqual(form.preparations, [{ type: '即调', amount: '', unit: 'hour', note: '' }])
  assert.equal(form.tried, true)
  for (const key of ['name', 'imagePath', 'source', 'glasswareId', 'steps', 'rating', 'tastingNote']) assert.equal(form[key], '')
})

test('quick base uses the five constants and replaces the prior base without mutation', () => {
  const original = createEmptyRecipeForm()
  const expected = ['金酒', '白朗姆', '威士忌', '伏特加', '龙舌兰']
  assert.deepEqual(require('../miniprogram/domain/constants').QUICK_BASE_SPIRITS.map((item) => item.name), expected)
  const first = applyQuickBase(original, '金酒')
  const next = applyQuickBase(first, { name: '龙舌兰', id: 'tequila' })
  assert.equal(original.ingredients.length, 2)
  assert.equal(next.ingredients.filter((item) => item.category === 'base-spirit').length, 1)
  assert.deepEqual(next.ingredients.find((item) => item.category === 'base-spirit'), {
    name: '龙舌兰', category: 'base-spirit', amount: '', unit: 'ml', alcoholic: true, abv: 40, materialId: '', status: 'new', observation: ''
  })
})

test('ingredient names can replace citrus and syrup while retaining amount and unit', () => {
  const form = createEmptyRecipeForm()
  form.ingredients[0].amount = '25'
  form.ingredients[1].amount = '15'
  const citrus = replaceIngredientName(form, 0, '青柠汁')
  const syrup = replaceIngredientName(citrus, 1, '蜂蜜糖浆')
  assert.deepEqual(syrup.ingredients.slice(0, 2).map(({ name, amount, unit }) => ({ name, amount, unit })), [
    { name: '青柠汁', amount: '25', unit: 'ml' },
    { name: '蜂蜜糖浆', amount: '15', unit: 'ml' }
  ])
})

test('ingredient draft derives category defaults and preserves existing material metadata', () => {
  assert.deepEqual(createIngredientDraft('other-solid', '盐'), {
    name: '盐', category: 'other-solid', amount: '', unit: 'g', alcoholic: false, abv: null, materialId: '', status: 'new', observation: ''
  })
  assert.equal(createIngredientDraft('soda', '汤力水').unit, 'top-up')
  const existing = { id: 'm1', name: '黑朗姆', category: 'other-base-spirit', defaultUnit: 'ml', alcoholic: true, abv: 47, owned: true }
  assert.deepEqual(createIngredientDraft(null, null, existing), {
    name: '黑朗姆', category: 'other-base-spirit', amount: '', unit: 'ml', alcoholic: true, abv: 47, materialId: 'm1', status: 'existing', observation: ''
  })
})

test('validation accepts top-up and missing alcoholic abv but rejects incomplete used values and bad prep', () => {
  const form = createEmptyRecipeForm()
  form.name = 'Highball'
  form.ingredients = [createIngredientDraft('soda', '苏打水')]
  form.preparations = [{ type: '即调', amount: '', unit: 'hour', note: '' }]
  assert.equal(normalizeAndValidateForm(form).valid, true)
  form.ingredients = [createIngredientDraft('liqueur', '橙味利口酒')]
  form.ingredients[0].amount = 30
  assert.equal(normalizeAndValidateForm(form).valid, true)
  form.ingredients[0].amount = 0
  assert.match(normalizeAndValidateForm(form).errors.ingredients, /用量/)
  form.ingredients[0].amount = 30
  form.preparations = [{ type: '冷冻', amount: 0, unit: 'hour', note: '' }]
  assert.match(normalizeAndValidateForm(form).errors.preparations, /时长/)
  form.preparations = [{ type: '即调', amount: '', unit: 'hour', note: '' }, { type: '冷冻', amount: 1, unit: 'hour', note: '' }]
  assert.deepEqual(normalizeAndValidateForm(form).form.preparations.map((item) => item.type), ['冷冻'])
})

test('payload uses ingredient material ids and preserves recipe data and material drafts', () => {
  const form = createEmptyRecipeForm()
  form.name = '蜂蜜酸酒'; form.source = '书'; form.imagePath = '/tmp/x'; form.steps = '摇匀'; form.rating = '顶尖'; form.tastingNote = '酸甜'; form.tried = false
  form.ingredients = [{ ...createIngredientDraft('citrus', '青柠汁'), materialId: 'm-lime', status: 'existing', amount: '25', observation: '新鲜' }, { ...createIngredientDraft('liqueur', '君度'), amount: 20 }]
  const result = buildRecipePayload(form)
  assert.deepEqual(result.recipe.ingredients, [{ materialId: 'm-lime', amount: 25, unit: 'ml' }, { materialId: '', amount: 20, unit: 'ml' }])
  assert.equal(result.recipe.tastingNote, '酸甜')
  assert.equal(result.recipe.tried, false)
  assert.deepEqual(result.materialDrafts.map((item) => item.name), ['君度'])
  assert.deepEqual(result.recipe.materialObservations, [{ materialId: 'm-lime', note: '新鲜' }])
})

test('payload keeps a resolvable observation for a newly drafted material', () => {
  const form = createEmptyRecipeForm()
  form.name = '君度酸酒'
  form.ingredients = [{ ...createIngredientDraft('liqueur', '君度'), amount: 20, observation: '橙香更明显' }]
  const result = buildRecipePayload(form)
  assert.deepEqual(result.recipe.materialObservations, [{ materialId: '', materialName: '君度', note: '橙香更明显' }])
  assert.equal(result.materialDrafts[0].name, '君度')
})

test('preview delegates enriched material rows to existing ABV calculation', () => {
  const preview = getFormPreview({ ...createEmptyRecipeForm(), ingredients: [
    { ...createIngredientDraft('base-spirit', '金酒'), amount: 50 },
    { ...createIngredientDraft('soda', '苏打水') }
  ] })
  assert.deepEqual(preview, { status: 'ok', abv: 13.3, liquidVolume: 150, missing: [], ignored: [] })
})
