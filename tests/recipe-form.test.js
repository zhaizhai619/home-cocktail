const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createEmptyRecipeForm,
  applyQuickBase,
  replaceIngredientName,
  createIngredientDraft,
  normalizeAndValidateForm,
  buildRecipePayload,
  resolveRecipeMaterialIds,
  getGlasswareSelection,
  updateIngredientField,
  hydrateRecipeIngredient,
  selectExistingIngredient,
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
  assert.deepEqual(result.recipe.ingredients, [{ materialId: 'm-lime', amount: 25, unit: 'ml' }, { materialId: '', draftKey: 'liqueur:君度', amount: 20, unit: 'ml' }])
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
  assert.deepEqual(result.recipe.materialObservations, [{ materialId: '', draftKey: 'liqueur:君度', note: '橙香更明显' }])
  assert.equal(result.materialDrafts[0].name, '君度')
})

test('editing preserves historical material observations when no new row note is entered', () => {
  const form = createEmptyRecipeForm()
  form.name = '旧配方'
  form.materialObservations = [{ materialId: 'm-lime', note: '上次的青柠很香' }]
  form.ingredients = [{ ...createIngredientDraft('citrus', '青柠汁'), materialId: 'm-lime', status: 'existing', amount: 25 }]
  assert.deepEqual(buildRecipePayload(form).recipe.materialObservations, [{ materialId: 'm-lime', note: '上次的青柠很香' }])
})

test('editing appends a new row observation without replacing historical observations', () => {
  const form = createEmptyRecipeForm()
  form.name = '旧配方'
  form.materialObservations = [{ materialId: 'm-lime', note: '上次的青柠很香' }]
  form.ingredients = [{ ...createIngredientDraft('liqueur', '君度'), amount: 20, observation: '这次橙香更明显' }]
  assert.deepEqual(buildRecipePayload(form).recipe.materialObservations, [
    { materialId: 'm-lime', note: '上次的青柠很香' },
    { materialId: '', draftKey: 'liqueur:君度', note: '这次橙香更明显' }
  ])
})

test('deduplicates new material drafts and resolves every temporary reference by category and name key', () => {
  const form = createEmptyRecipeForm()
  form.name = '重复材料测试'
  form.ingredients = [
    { ...createIngredientDraft('liqueur', '君度'), amount: 20, observation: '第一杯' },
    { ...createIngredientDraft('liqueur', ' 君度 '), amount: 10, observation: '第二杯' },
    { ...createIngredientDraft('other-liquid', '君度'), amount: 5, observation: '不同分类' }
  ]
  const payload = buildRecipePayload(form)
  assert.deepEqual(payload.materialDrafts.map((draft) => draft.draftKey), ['liqueur:君度', 'other-liquid:君度'])
  const recipe = resolveRecipeMaterialIds(payload.recipe, { 'liqueur:君度': 'm-cointreau', 'other-liquid:君度': 'm-other' })
  assert.deepEqual(recipe.ingredients, [
    { materialId: 'm-cointreau', amount: 20, unit: 'ml' },
    { materialId: 'm-cointreau', amount: 10, unit: 'ml' },
    { materialId: 'm-other', amount: 5, unit: 'ml' }
  ])
  assert.deepEqual(recipe.materialObservations, [
    { materialId: 'm-cointreau', note: '第一杯' }, { materialId: 'm-cointreau', note: '第二杯' }, { materialId: 'm-other', note: '不同分类' }
  ])
})

test('glassware selection returns a stable picker index and selected label', () => {
  const glassware = [{ id: 'highball', name: '高球杯' }, { id: 'coupe', name: '碟形杯' }]
  assert.deepEqual(getGlasswareSelection(glassware, 'coupe'), { glasswareIndex: 1, glasswareLabel: '碟形杯' })
  assert.deepEqual(getGlasswareSelection(glassware, 'gone'), { glasswareIndex: 0, glasswareLabel: '选择杯具' })
})

test('existing material metadata is locked while editable recipe values remain changeable', () => {
  const form = createEmptyRecipeForm()
  form.ingredients = [{ ...createIngredientDraft(null, null, { id: 'm-gin', name: '金酒', category: 'base-spirit', defaultUnit: 'ml', alcoholic: true, abv: 40 }), amount: 30 }]
  const attempted = updateIngredientField(form, 0, 'abv', 55)
  const edited = updateIngredientField(attempted, 0, 'amount', 45)
  assert.equal(attempted.ingredients[0].abv, 40)
  assert.equal(edited.ingredients[0].amount, 45)
  assert.equal(edited.ingredients[0].materialId, 'm-gin')
})

test('orphan recipe material has an identifiable fallback and blocks saving until repaired', () => {
  const orphan = hydrateRecipeIngredient({ materialId: 'gone-material', amount: 20, unit: 'ml' }, null)
  assert.equal(orphan.name, '缺失材料（gone-material）')
  const form = createEmptyRecipeForm()
  form.name = '孤儿配方'; form.ingredients = [orphan]
  assert.match(normalizeAndValidateForm(form).errors.ingredients, /已删除/)
})

test('selecting an existing material retains the typed row observation', () => {
  const form = createEmptyRecipeForm()
  form.ingredients = [{ ...createIngredientDraft('liqueur', '君度'), amount: 20, observation: '手写备注' }]
  const selected = selectExistingIngredient(form, 0, { id: 'm-cointreau', name: '君度', category: 'liqueur', defaultUnit: 'ml', alcoholic: true, abv: 40 })
  assert.deepEqual(selected.ingredients[0], { ...createIngredientDraft(null, null, { id: 'm-cointreau', name: '君度', category: 'liqueur', defaultUnit: 'ml', alcoholic: true, abv: 40 }), amount: 20, observation: '手写备注' })
})

test('preview delegates enriched material rows to existing ABV calculation', () => {
  const preview = getFormPreview({ ...createEmptyRecipeForm(), ingredients: [
    { ...createIngredientDraft('base-spirit', '金酒'), amount: 50 },
    { ...createIngredientDraft('soda', '苏打水') }
  ] })
  assert.deepEqual(preview, { status: 'ok', abv: 13.3, liquidVolume: 150, missing: [], ignored: [] })
})
