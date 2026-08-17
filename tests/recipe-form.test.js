const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createEmptyRecipeForm,
  applyQuickBase,
  replaceIngredientName,
  createIngredientDraft,
  normalizeAndValidateForm,
  buildRecipePayload,
  buildAiNamingInput,
  resolveRecipeMaterialIds,
  getGlasswareSelection,
  updateIngredientField,
  hydrateRecipeIngredient,
  selectExistingIngredient,
  orchestrateRecipeSave,
  getFormPreview,
  getMissingAlcoholAbvHint,
  updateTriedState,
  applyMaterialSelection,
  reorderIngredient,
  createAdvancePreparation,
  updateAdvancePreparation,
  applyAdvanceMaterialSelection,
  removeAdvancePreparation
} = require('../miniprogram/pages/recipe-edit/model')

const { hydrateEquipmentSelections } = require('../miniprogram/pages/recipe-edit/model')

test('empty recipe form includes the fast-entry defaults', () => {
  const form = createEmptyRecipeForm()
  assert.deepEqual(form.ingredients.map(({ name, unit, amount }) => ({ name, unit, amount })), [
    { name: '柠檬汁', unit: 'ml', amount: '' },
    { name: '糖浆', unit: 'ml', amount: '' }
  ])
  assert.deepEqual(form.preparations, [{ type: '即调', note: '' }])
  assert.equal(form.tried, true)
  for (const key of ['name', 'imagePath', 'source', 'glasswareId', 'steps', 'rating', 'tastingNote']) assert.equal(form[key], '')
  assert.equal(form.musicNaming, null)
})

test('AI song selection saves only the song title as the recipe name and keeps its explanation metadata', () => {
  const form = createEmptyRecipeForm()
  form.name = 'No No No'
  form.musicNaming = { songId: 'song-1', songTitle: 'No No No', artist: 'Shark', reason: '歌曲的反抗感和这杯酒的清爽气质很契合。' }
  form.ingredients[0].amount = 20
  form.ingredients[1].amount = 10

  const recipe = buildRecipePayload(form).recipe
  assert.equal(recipe.name, 'No No No')
  assert.deepEqual(recipe.musicNaming, form.musicNaming)
})

test('AI naming input includes direct ingredients and full advance preparation context', () => {
  const form = createEmptyRecipeForm()
  form.ingredients = [
    { kind: 'prepared-output', preparationId: 'prep-1', name: '青瓜澄清液', amount: 40, unit: 'ml' },
    { ...createIngredientDraft('citrus', '柠檬汁'), amount: 15, unit: 'ml' },
    { ...createIngredientDraft('citrus', '青柠汁'), amount: 15, unit: 'ml' }
  ]
  form.advancePreparations = [{
    id: 'prep-1',
    outputName: '青瓜澄清液',
    ingredients: [
      { ...createIngredientDraft('fruit', '黄瓜'), amount: 200, unit: 'g' },
      { ...createIngredientDraft('base-spirit', '金酒'), amount: 500, unit: 'ml' }
    ],
    steps: '黄瓜切片\n与金酒低温浸泡 8 小时'
  }]

  assert.deepEqual(buildAiNamingInput(form), {
    ingredients: [
      { name: '柠檬汁', amount: 15, unit: 'ml' },
      { name: '青柠汁', amount: 15, unit: 'ml' }
    ],
    advancePreparations: [{
      name: '青瓜澄清液', amount: 40, unit: 'ml',
      ingredients: [
        { name: '黄瓜', amount: 200, unit: 'g' },
        { name: '金酒', amount: 500, unit: 'ml' }
      ],
      steps: ['黄瓜切片', '与金酒低温浸泡 8 小时']
    }]
  })
})

test('ingredient render keys are unique and survive row replacements', () => {
  const form = createEmptyRecipeForm()
  const initialKeys = form.ingredients.map((item) => item.renderKey)
  assert.equal(new Set(initialKeys).size, form.ingredients.length)
  assert.ok(initialKeys.every(Boolean))

  const edited = updateIngredientField(form, 0, 'amount', '25')
  assert.equal(edited.ingredients[0].renderKey, initialKeys[0])
  const renamed = replaceIngredientName(edited, 0, '青柠汁')
  assert.equal(renamed.ingredients[0].renderKey, initialKeys[0])
  const selected = selectExistingIngredient(renamed, 0, { id: 'm-lime', name: '青柠汁', category: 'citrus', defaultUnit: 'ml', alcoholic: false, abv: null })
  assert.equal(selected.ingredients[0].renderKey, initialKeys[0])

  const withBase = applyQuickBase(form, '金酒')
  const baseKey = withBase.ingredients.find((item) => item.category === 'base-spirit').renderKey
  const replacedBase = applyQuickBase(withBase, '伏特加')
  assert.equal(replacedBase.ingredients.find((item) => item.category === 'base-spirit').renderKey, baseKey)
})

test('material selection appends one library material or replaces one row without requiring typing', () => {
  const form = createEmptyRecipeForm()
  form.ingredients[0].amount = '25'
  const gin = { id: 'gin', name: '金酒', category: 'base-spirit', defaultUnit: 'ml', alcoholic: true, abv: 40 }
  const appended = applyMaterialSelection(form, -1, gin)
  assert.equal(appended.ingredients.length, form.ingredients.length + 1)
  assert.deepEqual({ materialId: appended.ingredients[0].materialId, name: appended.ingredients[0].name, amount: appended.ingredients[0].amount }, { materialId: 'gin', name: '金酒', amount: '' })

  const replaced = applyMaterialSelection(form, 0, { name: '玻萝汁', category: 'dairy/juice', defaultUnit: 'ml', alcoholic: false })
  assert.equal(replaced.ingredients.length, form.ingredients.length)
  assert.deepEqual({ materialId: replaced.ingredients[0].materialId, name: replaced.ingredients[0].name, amount: replaced.ingredients[0].amount }, { materialId: '', name: '玻萝汁', amount: '25' })
})

test('new base spirits and liqueurs stay ahead of other ingredients in their selection order', () => {
  let form = createEmptyRecipeForm()
  form = applyMaterialSelection(form, -1, { id: 'gin', name: '金酒', category: 'base-spirit', defaultUnit: 'ml', alcoholic: true, abv: 40 })
  form = applyMaterialSelection(form, -1, { id: 'coconut', name: '椰子利口酒', category: 'liqueur', defaultUnit: 'ml', alcoholic: true, abv: 20 })
  form = applyMaterialSelection(form, -1, { id: 'rum', name: '深色朗姆', category: 'other-base-spirit', defaultUnit: 'ml', alcoholic: true, abv: 40 })
  form = applyMaterialSelection(form, -1, { id: 'pineapple', name: '菠萝汁', category: 'dairy/juice', defaultUnit: 'ml', alcoholic: false })

  assert.deepEqual(form.ingredients.map(({ name }) => name), ['金酒', '椰子利口酒', '深色朗姆', '菠萝汁', '柠檬汁', '糖浆'])
})

test('default ingredient order keeps ordinary materials before staples and puts soda tonic and spices last', () => {
  let form = createEmptyRecipeForm()
  form = applyMaterialSelection(form, -1, { id: 'soda', name: '气泡水', category: 'soda/tonic', defaultUnit: 'top-up', alcoholic: false })
  form = applyMaterialSelection(form, -1, { id: 'pineapple', name: '菠萝汁', category: 'dairy/juice', defaultUnit: 'ml', alcoholic: false })
  form = applyMaterialSelection(form, -1, { id: 'gin', name: '金酒', category: 'base-spirit', defaultUnit: 'ml', alcoholic: true, abv: 40 })
  form = applyMaterialSelection(form, -1, { id: 'tonic', name: '汤力水', category: 'soda/tonic', defaultUnit: 'top-up', alcoholic: false })
  form = applyMaterialSelection(form, -1, { id: 'cinnamon', name: '肉桂', category: 'other-solid', defaultUnit: 'g', alcoholic: false })

  assert.deepEqual(form.ingredients.map(({ name }) => name), [
    '金酒', '菠萝汁', '柠檬汁', '糖浆', '气泡水', '汤力水', '肉桂'
  ])
})

test('default ingredient order keeps prepared outputs before spirits and other materials', () => {
  let form = createAdvancePreparation(createEmptyRecipeForm())
  const preparationId = form.advancePreparations[0].id
  form = updateAdvancePreparation(form, preparationId, 'outputName', '混合果汁')
  form = applyMaterialSelection(form, -1, { id: 'gin', name: '金酒', category: 'base-spirit', defaultUnit: 'ml', alcoholic: true, abv: 40 })
  form = applyMaterialSelection(form, -1, { id: 'coconut', name: '椰子利口酒', category: 'liqueur', defaultUnit: 'ml', alcoholic: true, abv: 20 })
  form = applyMaterialSelection(form, -1, { id: 'pineapple', name: '菠萝汁', category: 'dairy/juice', defaultUnit: 'ml', alcoholic: false })

  assert.deepEqual(form.ingredients.map(({ name }) => name), ['混合果汁', '金酒', '椰子利口酒', '菠萝汁', '柠檬汁', '糖浆'])
  assert.equal(form.ingredientOrderCustomized, false)
})

test('ingredient drag reorders exactly one row and preserves every row value', () => {
  const form = createEmptyRecipeForm()
  form.ingredients = [
    { ...createIngredientDraft('base-spirit', '金酒'), amount: 45 },
    { ...createIngredientDraft('citrus', '柠檬汁'), amount: 25 },
    { ...createIngredientDraft('syrup/staple', '普通糖浆'), amount: 10 }
  ]
  const moved = reorderIngredient(form, 2, 0)
  assert.deepEqual(moved.ingredients.map(({ name, amount }) => ({ name, amount })), [
    { name: '普通糖浆', amount: 10 },
    { name: '金酒', amount: 45 },
    { name: '柠檬汁', amount: 25 }
  ])
  assert.equal(moved.ingredientOrderCustomized, true)
  assert.deepEqual(form.ingredients.map(({ name }) => name), ['金酒', '柠檬汁', '普通糖浆'])
})

test('new materials append after the user customizes ingredient order', () => {
  let form = createEmptyRecipeForm()
  form.ingredients = [
    { ...createIngredientDraft('base-spirit', '金酒'), amount: 45 },
    { ...createIngredientDraft('citrus', '柠檬汁'), amount: 25 },
    { ...createIngredientDraft('syrup/staple', '糖浆'), amount: 10 }
  ]
  form = reorderIngredient(form, 2, 0)
  form = applyMaterialSelection(form, -1, { id: 'coconut', name: '椰子利口酒', category: 'liqueur', defaultUnit: 'ml', alcoholic: true, abv: 20 })

  assert.deepEqual(form.ingredients.map(({ name }) => name), ['糖浆', '金酒', '柠檬汁', '椰子利口酒'])
})

test('multiple advance preparations create editable serving rows and never create output materials', () => {
  let form = createEmptyRecipeForm()
  form.name = '双预制嗨棒'
  form.ingredients = [{ ...createIngredientDraft('soda/tonic', '苏打水'), amount: '', unit: 'top-up' }]
  form = createAdvancePreparation(form)
  const firstId = form.advancePreparations[0].id
  form = updateAdvancePreparation(form, firstId, 'outputName', '菠萝朗姆')
  form = updateAdvancePreparation(form, firstId, 'steps', '菠萝切块\n浸泡 3–7 天后过滤')
  form = applyAdvanceMaterialSelection(form, firstId, -1, { id: 'rum', name: '白朗姆', category: 'base-spirit', defaultUnit: 'ml', alcoholic: true, abv: 40 })
  form.advancePreparations[0].ingredients[0].amount = 500
  form = createAdvancePreparation(form)
  const secondId = form.advancePreparations[1].id
  form = updateAdvancePreparation(form, secondId, 'outputName', '澄清果汁')
  form = updateAdvancePreparation(form, secondId, 'steps', '混合后过滤')
  form = applyAdvanceMaterialSelection(form, secondId, -1, { id: 'juice', name: '苹果汁', category: 'dairy/juice', defaultUnit: 'ml', alcoholic: false })
  form.advancePreparations[1].ingredients[0].amount = 300
  const preparedRows = form.ingredients.filter(({ kind }) => kind === 'prepared-output')
  preparedRows[0].amount = 40; preparedRows[0].unit = 'ml'
  preparedRows[1].amount = 20; preparedRows[1].unit = 'ml'
  form.preparations = [{ type: '冷泡/浸泡', durationText: '3–7天', note: '' }]

  const payload = buildRecipePayload(form)
  assert.deepEqual(payload.recipe.ingredients.filter(({ kind }) => kind === 'prepared-output'), [
    { kind: 'prepared-output', preparationId: firstId, amount: 40, unit: 'ml' },
    { kind: 'prepared-output', preparationId: secondId, amount: 20, unit: 'ml' }
  ])
  assert.equal(payload.recipe.advancePreparations.length, 2)
  assert.deepEqual(payload.recipe.advancePreparations[0].ingredients, [{ materialId: 'rum', amount: 500, unit: 'ml' }])
  assert.deepEqual(payload.recipe.advancePreparations[1].ingredients, [{ materialId: 'juice', amount: 300, unit: 'ml' }])
  assert.deepEqual(payload.recipe.preparations, [{ type: '冷泡/浸泡', durationText: '3–7天', note: '' }])
  assert.equal(payload.materialDrafts.some(({ name }) => ['菠萝朗姆', '澄清果汁'].includes(name)), false)
  assert.deepEqual(getFormPreview(form), { status: 'prepared', abv: null, liquidVolume: 0, missing: [], ignored: [] })
  assert.equal(getMissingAlcoholAbvHint(form), '含预调成品，暂不计算酒精度')
})

test('removing one advance preparation removes only its linked serving row', () => {
  let form = createAdvancePreparation(createEmptyRecipeForm())
  const firstId = form.advancePreparations[0].id
  form = createAdvancePreparation(form)
  const secondId = form.advancePreparations[1].id
  const removed = removeAdvancePreparation(form, firstId)
  assert.deepEqual(removed.advancePreparations.map(({ id }) => id), [secondId])
  assert.deepEqual(removed.ingredients.filter(({ kind }) => kind === 'prepared-output').map(({ preparationId }) => preparationId), [secondId])
  assert.deepEqual(removed.ingredients.filter(({ kind }) => kind !== 'prepared-output').map(({ name }) => name), ['柠檬汁', '糖浆'])
})

test('advance preparation allows blank steps, instant preparation and an amountless to-taste material', () => {
  let form = createEmptyRecipeForm()
  form.name = '随调预制酒'
  form.ingredients = [{ ...createIngredientDraft('soda/tonic', '苏打水'), unit: 'top-up' }]
  form = createAdvancePreparation(form)
  const preparationId = form.advancePreparations[0].id
  form = updateAdvancePreparation(form, preparationId, 'outputName', '香料液')
  form = applyAdvanceMaterialSelection(form, preparationId, -1, { name: '混合香料', category: 'other-solid', defaultUnit: 'g', alcoholic: false })
  form.advancePreparations[0].ingredients[0].amount = ''
  form.advancePreparations[0].ingredients[0].unit = 'to-taste'
  form.ingredients.find(({ kind }) => kind === 'prepared-output').amount = 20
  form.preparations = [{ type: '即调', note: '' }]

  const checked = normalizeAndValidateForm(form)
  assert.equal(checked.valid, true)
  const payload = buildRecipePayload(form)
  assert.deepEqual(payload.recipe.advancePreparations[0].steps, [])
  assert.deepEqual(payload.recipe.advancePreparations[0].ingredients, [{ materialId: '', draftKey: 'other-solid:混合香料', amount: null, unit: 'to-taste' }])
  assert.deepEqual(payload.recipe.preparations.map(({ type }) => type), ['即调'])
})

test('text ingredient amounts are valid and persist unchanged', () => {
  const form = createEmptyRecipeForm()
  form.name = '黄瓜酒'
  form.ingredients = [{ ...createIngredientDraft('fruit', '黄瓜'), amount: '半', unit: 'piece' }]
  form.preparations = [{ type: '即调', amount: '', unit: 'hour', note: '' }]

  assert.equal(normalizeAndValidateForm(form).valid, true)
  assert.deepEqual(buildRecipePayload(form).recipe.ingredients, [
    { materialId: '', draftKey: 'fruit:黄瓜', amount: '半', unit: 'piece' }
  ])
})

test('tried state defaults on and clearing it also clears the rating', () => {
  const form = createEmptyRecipeForm()
  assert.equal(form.tried, true)
  form.rating = '夯'

  const untried = updateTriedState(form, false)

  assert.equal(untried.tried, false)
  assert.equal(untried.rating, '')
  assert.equal(form.rating, '夯')
})

test('quick base uses the five constants and replaces the prior base without mutation', () => {
  const original = createEmptyRecipeForm()
  const expected = ['金酒', '白朗姆', '威士忌', '伏特加', '龙舌兰']
  assert.deepEqual(require('../miniprogram/domain/constants').QUICK_BASE_SPIRITS.map((item) => item.name), expected)
  const first = applyQuickBase(original, '金酒')
  const next = applyQuickBase(first, { name: '龙舌兰', id: 'tequila' })
  assert.equal(original.ingredients.length, 2)
  assert.equal(next.ingredients.filter((item) => item.category === 'base-spirit').length, 1)
  const { renderKey, ...base } = next.ingredients.find((item) => item.category === 'base-spirit')
  assert.ok(renderKey)
  assert.deepEqual(base, {
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
  const { renderKey: solidRenderKey, ...solid } = createIngredientDraft('other-solid', '盐')
  assert.ok(solidRenderKey)
  assert.deepEqual(solid, {
    name: '盐', category: 'other-solid', amount: '', unit: 'g', alcoholic: false, abv: null, materialId: '', status: 'new', observation: ''
  })
  assert.equal(createIngredientDraft('soda', '汤力水').unit, 'top-up')
  const existing = { id: 'm1', name: '黑朗姆', category: 'other-base-spirit', defaultUnit: 'ml', alcoholic: true, abv: 47, owned: true }
  const { renderKey: existingRenderKey, ...existingDraft } = createIngredientDraft(null, null, existing)
  assert.ok(existingRenderKey)
  assert.deepEqual(existingDraft, {
    name: '黑朗姆', category: 'other-base-spirit', amount: '', unit: 'ml', alcoholic: true, abv: 47, materialId: 'm1', status: 'existing', abvMissing: false, abvNeedsPersist: false, observation: ''
  })
  assert.equal(createIngredientDraft(null, null, { id: 'simple', name: '普通糖浆', category: 'syrup/staple', defaultUnit: 'ml', alcoholic: false }).name, '糖浆')
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
  form.preparations = [{ type: '冷冻', durationText: '', note: '' }]
  assert.equal(normalizeAndValidateForm(form).valid, true)
  assert.deepEqual(normalizeAndValidateForm(form).form.preparations, [{ type: '冷冻', durationText: '', note: '' }])
  form.preparations = [{ type: '即调', note: '' }, { type: '冷冻', durationText: '1小时', note: '' }]
  assert.deepEqual(normalizeAndValidateForm(form).form.preparations.map((item) => item.type), ['冷冻'])
})

test('hidden orphan tools remain saveable and preserved while a visible orphan glassware still blocks save', () => {
  const form = createEmptyRecipeForm()
  form.name = '旧配方'
  form.ingredients = [createIngredientDraft('base-spirit', '金酒')]
  form.ingredients[0].amount = 45
  form.toolIds = ['gone-tool']
  form.orphanToolIds = ['gone-tool']

  const checked = normalizeAndValidateForm(form)
  assert.equal(checked.valid, true)
  assert.deepEqual(buildRecipePayload(form).recipe.toolIds, ['gone-tool'])

  form.orphanGlasswareId = 'gone-glass'
  assert.match(normalizeAndValidateForm(form).errors.equipment, /酒杯/)
})

test('payload uses ingredient material ids and preserves recipe data and material drafts', () => {
  const form = createEmptyRecipeForm()
  form.name = '蜂蜜酸酒'; form.source = '书'; form.imagePath = '/tmp/x'; form.steps = '摇匀'; form.rating = '顶尖'; form.tastingNote = '酸甜'; form.tried = false
  form.ingredients = [{ ...createIngredientDraft('citrus', '青柠汁'), materialId: 'm-lime', status: 'existing', amount: '25', observation: '新鲜' }, { ...createIngredientDraft('liqueur', '君度'), amount: 20 }]
  const result = buildRecipePayload(form)
  assert.deepEqual(result.recipe.ingredients, [{ materialId: '', draftKey: 'liqueur:君度', amount: 20, unit: 'ml' }, { materialId: 'm-lime', amount: 25, unit: 'ml' }])
  assert.equal(result.recipe.ingredientOrderCustomized, false)
  assert.equal(result.recipe.tastingNote, '酸甜')
  assert.equal(result.recipe.tried, false)
  assert.deepEqual(result.materialDrafts.map((item) => item.name), ['君度'])
  assert.equal(result.materialDrafts.some((item) => Object.hasOwn(item, 'renderKey')), false)
  assert.doesNotMatch(JSON.stringify(result), /renderKey/)
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

test('editing preserves historical material observation timestamps', () => {
  const form = createEmptyRecipeForm()
  form.name = '有时间记录的旧配方'
  form.materialObservations = [{ materialId: 'm-lime', note: '上次的青柠很香', createdAt: '2026-07-19T12:00:00.000Z' }]
  form.ingredients = [{ ...createIngredientDraft('citrus', '青柠汁'), materialId: 'm-lime', status: 'existing', amount: 25 }]
  assert.deepEqual(buildRecipePayload(form).recipe.materialObservations, [{ materialId: 'm-lime', note: '上次的青柠很香', createdAt: '2026-07-19T12:00:00.000Z' }])
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

test('glassware selection returns a stable index and shared capacity label', () => {
  const glassware = [{ id: 'highball', name: '高球杯', capacityMl: 420 }, { id: 'coupe', name: '碟形杯', capacityMl: 180 }]
  assert.deepEqual(getGlasswareSelection(glassware, 'coupe'), { glasswareIndex: 1, glasswareLabel: '碟形杯-180ml' })
  assert.deepEqual(getGlasswareSelection(glassware, 'gone'), { glasswareIndex: 0, glasswareLabel: '选择酒杯' })
})

test('ABV hint names only alcoholic materials whose strength is missing', () => {
  const form = createEmptyRecipeForm()
  form.ingredients = [
    { ...createIngredientDraft('liqueur', '金巴利'), amount: 15, abv: 0 },
    { ...createIngredientDraft('liqueur', '椰子利口酒'), amount: '', abv: -1 },
    { ...createIngredientDraft('liqueur', '金巴利'), amount: 20, abv: '未知' },
    { ...createIngredientDraft('liqueur', '橙皮酒'), amount: 10, abv: 101 },
    { ...createIngredientDraft('citrus', '柠檬汁'), amount: '' }
  ]
  const hint = '补充「金巴利、椰子利口酒、橙皮酒」的酒精度后，即可估算整杯酒精度。'
  assert.equal(getMissingAlcoholAbvHint(form), hint)
  form.ingredients.forEach((row, index) => { row.amount = index % 2 === 0 ? '' : index + 10 })
  assert.equal(getMissingAlcoholAbvHint(form), hint)
  form.ingredients[0].abv = 25
  form.ingredients[1].abv = 21
  form.ingredients[2].abv = 25
  form.ingredients[3].abv = 40
  assert.equal(getMissingAlcoholAbvHint(form), '')
  form.ingredients[4].amount = 20
  assert.equal(getMissingAlcoholAbvHint(form), '')
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
  const renderKey = form.ingredients[0].renderKey
  const selected = selectExistingIngredient(form, 0, { id: 'm-cointreau', name: '君度', category: 'liqueur', defaultUnit: 'ml', alcoholic: true, abv: 40 })
  const { renderKey: selectedRenderKey, ...selectedIngredient } = selected.ingredients[0]
  const { renderKey: unusedRenderKey, ...expectedIngredient } = { ...createIngredientDraft(null, null, { id: 'm-cointreau', name: '君度', category: 'liqueur', defaultUnit: 'ml', alcoholic: true, abv: 40 }), amount: 20, observation: '手写备注' }
  assert.equal(selectedRenderKey, renderKey)
  assert.ok(unusedRenderKey)
  assert.deepEqual(selectedIngredient, expectedIngredient)
})

test('missing existing alcoholic ABV accepts a valid repair, emits an update, and rejects zero or over-range values', () => {
  const form = createEmptyRecipeForm()
  form.name = '白色佳人'
  form.ingredients = [{ ...createIngredientDraft(null, null, { id: 'm-cointreau', name: '君度', category: 'liqueur', defaultUnit: 'ml', alcoholic: true, abv: null }), amount: 20 }]
  const repaired = updateIngredientField(form, 0, 'abv', '40')
  assert.deepEqual(buildRecipePayload(repaired).materialUpdates, [{ id: 'm-cointreau', abv: 40 }])
  assert.match(normalizeAndValidateForm(updateIngredientField(form, 0, 'abv', '0')).errors.ingredients, /酒精度/)
  assert.match(normalizeAndValidateForm(updateIngredientField(form, 0, 'abv', '101')).errors.ingredients, /酒精度/)
})

test('every alcoholic row rejects filled invalid ABV values while allowing an empty ABV', () => {
  for (const abv of ['-5', '0', '101', 'NaN']) {
    const form = createEmptyRecipeForm()
    form.name = `ABV ${abv}`
    form.ingredients = [{ ...createIngredientDraft('liqueur', '君度'), amount: 20, abv }]
    assert.match(normalizeAndValidateForm(form).errors.ingredients, /酒精度/)
    assert.throws(() => buildRecipePayload(form), /酒精度/)
  }
  const empty = createEmptyRecipeForm()
  empty.name = '允许留空'
  empty.ingredients = [{ ...createIngredientDraft('liqueur', '君度'), amount: 20, abv: null }]
  assert.equal(normalizeAndValidateForm(empty).valid, true)
  assert.equal(buildRecipePayload(empty).materialDrafts[0].abv, null)
})

test('save orchestration toasts and does not navigate when the transaction rejects', () => {
  const messages = []; let navigations = 0
  const form = createEmptyRecipeForm(); form.name = '失败保存'; form.ingredients = [{ ...createIngredientDraft('citrus', '青柠汁'), amount: 25 }]
  const outcome = orchestrateRecipeSave({ repository: { saveRecipeWithMaterials() { throw new Error('offline') } }, form, notify: (message) => messages.push(message), navigateBack: () => { navigations++ } })
  assert.equal(outcome.saved, false)
  assert.equal(outcome.errors.form, '保存失败，请重试')
  assert.equal(outcome.form.name, '失败保存')
  assert.deepEqual(messages, ['保存失败，请重试'])
  assert.equal(navigations, 0)
})

test('preview delegates enriched material rows to existing ABV calculation', () => {
  const preview = getFormPreview({ ...createEmptyRecipeForm(), ingredients: [
    { ...createIngredientDraft('base-spirit', '金酒'), amount: 50 },
    { ...createIngredientDraft('soda', '苏打水') }
  ] })
  assert.deepEqual(preview, { status: 'ok', abv: 13.3, liquidVolume: 150, missing: [], ignored: [] })
})

test('capacity preview ignores untouched fast-entry rows just like recipe save and ABV preview', () => {
  const form = applyQuickBase(createEmptyRecipeForm(), '金酒')
  form.ingredients[0].amount = 40
  form.glasswareId = 'small'

  const hydrated = hydrateEquipmentSelections(form, [{ id: 'small', name: '小杯', capacityMl: 100 }], [])

  assert.deepEqual(hydrated.capacity, {
    status: 'under', liquidVolume: 40, capacityMl: 100, differenceMl: 60,
    message: '预计液体体积 40ml / 酒杯 100ml / 约剩 60ml', ignored: []
  })
})
