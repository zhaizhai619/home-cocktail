const { QUICK_BASE_SPIRITS, PREP_TYPES } = require('../../domain/constants')
const { createMaterialDefaults, getMaterialDisplayName, getMaterialIdentityKey } = require('../../domain/material')
const { getPreparationDurationText, normalizeMusicNaming, normalizePrepSelections, sortIngredientsByDefault } = require('../../domain/recipe')
const { calculateAbv } = require('../../domain/abv')
const { calculateGlassCapacity, formatGlasswareLabel } = require('../../domain/equipment')
const { settleOperation } = require('../../services/maybe-promise')

let ingredientRenderSequence = 0
let advancePreparationSequence = 0

function nextIngredientRenderKey() {
  ingredientRenderSequence += 1
  return `ingredient-${ingredientRenderSequence}`
}

function nextAdvancePreparationId(existing = []) {
  const used = new Set((Array.isArray(existing) ? existing : []).map((item) => item && item.id).filter(Boolean))
  let id
  do { id = `advance-preparation-${++advancePreparationSequence}` } while (used.has(id))
  return id
}

function isPreparedOutput(row) { return Boolean(row && row.kind === 'prepared-output' && row.preparationId) }

const EMPTY_INGREDIENT = (category, name) => createIngredientDraft(category, name)

function createIngredientDraft(category, name, material) {
  if (material && typeof material === 'object') {
    const numericAbv = Number(material.abv)
    const hasValidAbv = Number.isFinite(numericAbv) && numericAbv > 0 && numericAbv <= 100
    const abvMissing = material.alcoholic === true && !hasValidAbv
    return {
      renderKey: nextIngredientRenderKey(),
      name: getMaterialDisplayName(material.category, material.name), category: material.category || 'other-liquid', amount: '',
      unit: material.defaultUnit || 'ml', alcoholic: material.alcoholic === true,
      abv: hasValidAbv ? numericAbv : null, materialId: material.id || '',
      status: 'existing', abvMissing, abvNeedsPersist: abvMissing, observation: ''
    }
  }
  let defaults
  try { defaults = createMaterialDefaults(category || 'other-liquid', name || '') } catch (_) { defaults = createMaterialDefaults('other-liquid', name || '') }
  return {
    renderKey: nextIngredientRenderKey(),
    name: name || '', category: defaults.category, amount: '', unit: defaults.defaultUnit,
    alcoholic: defaults.alcoholic === true, abv: Number.isFinite(defaults.abv) ? defaults.abv : null,
    materialId: '', status: 'new', observation: ''
  }
}

function hydrateRecipeIngredient(ingredient, material, preparation) {
  const row = ingredient && typeof ingredient === 'object' ? ingredient : {}
  if (isPreparedOutput(row)) return {
    renderKey: nextIngredientRenderKey(), kind: 'prepared-output', preparationId: row.preparationId,
    name: preparation && preparation.outputName || '预调成品', amount: row.amount === null ? '' : row.amount,
    unit: row.unit || 'ml', status: 'prepared', observation: ''
  }
  if (material) return { ...createIngredientDraft(null, null, material), amount: row.amount === null ? '' : row.amount, unit: row.unit || material.defaultUnit }
  const orphanedMaterialId = String(row.materialId || '')
  return { ...createIngredientDraft('other-liquid', `缺失材料（${orphanedMaterialId || '未知'}）`), amount: row.amount === null ? '' : row.amount, unit: row.unit || 'ml', materialId: orphanedMaterialId, orphanedMaterialId, status: 'orphaned' }
}

function createEmptyRecipeForm() {
  return {
    id: '', name: '', imagePath: '', source: '', musicNaming: null, tried: true,
    ingredients: [EMPTY_INGREDIENT('citrus', '柠檬汁'), EMPTY_INGREDIENT('syrup', '糖浆')],
    ingredientOrderCustomized: false,
    advancePreparations: [],
    preparations: [{ type: '即调', note: '' }],
    glasswareId: '', toolIds: [], steps: '', rating: '', tastingNote: '', materialObservations: []
  }
}

function cloneForm(form) {
  const cloned = JSON.parse(JSON.stringify(form || createEmptyRecipeForm()))
  if (!Array.isArray(cloned.advancePreparations)) {
    cloned.advancePreparations = cloned.advancePreparation && typeof cloned.advancePreparation === 'object'
      ? [{ id: nextAdvancePreparationId(), ...cloned.advancePreparation }]
      : []
  }
  delete cloned.advancePreparation
  cloned.ingredients = (Array.isArray(cloned.ingredients) ? cloned.ingredients : []).map((row) => (
    row.renderKey ? row : { ...row, renderKey: nextIngredientRenderKey() }
  ))
  cloned.advancePreparations = cloned.advancePreparations.map((preparation) => {
    const item = { ...preparation, id: preparation.id || nextAdvancePreparationId(cloned.advancePreparations) }
    item.ingredients = (Array.isArray(item.ingredients) ? item.ingredients : []).map((row) => (
      row.renderKey ? row : { ...row, renderKey: nextIngredientRenderKey() }
    ))
    item.steps = typeof item.steps === 'string' ? item.steps : (Array.isArray(item.steps) ? item.steps.join('\n') : '')
    return item
  })
  for (const preparation of cloned.advancePreparations) {
    if (!cloned.ingredients.some((row) => isPreparedOutput(row) && row.preparationId === preparation.id)) {
      const lastPreparedIndex = cloned.ingredients.reduce((last, row, index) => isPreparedOutput(row) ? index : last, -1)
      cloned.ingredients.splice(lastPreparedIndex + 1, 0, { renderKey: nextIngredientRenderKey(), kind: 'prepared-output', preparationId: preparation.id, name: preparation.outputName || '预调成品', amount: '', unit: 'ml', status: 'prepared', observation: '' })
    }
  }
  const preparationIds = new Set(cloned.advancePreparations.map(({ id }) => id))
  cloned.ingredients = cloned.ingredients.filter((row) => !isPreparedOutput(row) || preparationIds.has(row.preparationId)).map((row) => {
    if (!isPreparedOutput(row)) return row
    const preparation = cloned.advancePreparations.find(({ id }) => id === row.preparationId)
    return { ...row, name: preparation && preparation.outputName || '预调成品', status: 'prepared' }
  })
  cloned.ingredientOrderCustomized = cloned.ingredientOrderCustomized === true
  if (!cloned.ingredientOrderCustomized) cloned.ingredients = sortIngredientsByDefault(cloned.ingredients)
  return cloned
}

function updateTriedState(form, tried) {
  const next = cloneForm(form)
  next.tried = tried === true
  if (!next.tried) next.rating = ''
  return next
}

function updateIngredientField(form, index, field, value) {
  const next = cloneForm(form); const row = next.ingredients[index]
  if (!row) return next
  if (isPreparedOutput(row) && !['amount', 'unit'].includes(field)) return next
  const locked = row.materialId && !row.orphanedMaterialId && ['name', 'category', 'alcoholic'].includes(field)
  const lockedAbv = row.materialId && !row.orphanedMaterialId && field === 'abv' && !row.abvNeedsPersist
  if (locked || lockedAbv) return next
  next.ingredients[index] = { ...row, [field]: value }
  if (field === 'abv' && row.abvNeedsPersist) {
    const abv = Number(value)
    next.ingredients[index].abvMissing = !Number.isFinite(abv) || abv <= 0 || abv > 100
  }
  if (field === 'name' && (!row.materialId || row.orphanedMaterialId)) {
    next.ingredients[index].materialId = ''
    next.ingredients[index].orphanedMaterialId = ''
    next.ingredients[index].status = 'new'
  }
  return next
}

function selectExistingIngredient(form, index, material) {
  const next = cloneForm(form); const previous = next.ingredients[index]
  if (!previous || !material) return next
  next.ingredients[index] = { ...createIngredientDraft(null, null, material), renderKey: previous.renderKey, amount: previous.amount, observation: previous.observation || '' }
  if (!next.ingredientOrderCustomized) next.ingredients = sortIngredientsByDefault(next.ingredients)
  return next
}

function applyMaterialSelection(form, index, material) {
  const next = cloneForm(form)
  if (!material || !String(material.name || '').trim()) return next
  const selected = material.id
    ? createIngredientDraft(null, null, material)
    : createIngredientDraft(material.category || 'other-liquid', String(material.name).trim())
  const targetIndex = Number(index)
  if (Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < next.ingredients.length) {
    const previous = next.ingredients[targetIndex]
    if (isPreparedOutput(previous)) return next
    next.ingredients[targetIndex] = {
      ...selected,
      renderKey: previous.renderKey,
      amount: previous.amount,
      observation: previous.observation || ''
    }
  } else next.ingredients.push(selected)
  if (!next.ingredientOrderCustomized) next.ingredients = sortIngredientsByDefault(next.ingredients)
  return next
}

function reorderIngredient(form, fromIndex, toIndex) {
  const next = cloneForm(form)
  const from = Number(fromIndex); const to = Number(toIndex)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= next.ingredients.length || to >= next.ingredients.length || from === to) return next
  const [moved] = next.ingredients.splice(from, 1)
  next.ingredients.splice(to, 0, moved)
  next.ingredientOrderCustomized = true
  return next
}

function createAdvancePreparation(form) {
  const next = cloneForm(form)
  const id = nextAdvancePreparationId(next.advancePreparations)
  const preparation = { id, outputName: '', ingredients: [], steps: '' }
  next.advancePreparations.push(preparation)
  next.ingredients.push({ renderKey: nextIngredientRenderKey(), kind: 'prepared-output', preparationId: id, name: '预调成品', amount: '', unit: 'ml', status: 'prepared', observation: '' })
  if (!next.ingredientOrderCustomized) next.ingredients = sortIngredientsByDefault(next.ingredients)
  return next
}

function updateAdvancePreparation(form, preparationId, field, value) {
  const next = cloneForm(form)
  const index = next.advancePreparations.findIndex(({ id }) => id === preparationId)
  if (index === -1 || !['outputName', 'steps'].includes(field)) return next
  next.advancePreparations[index] = { ...next.advancePreparations[index], [field]: value }
  if (field === 'outputName') next.ingredients = next.ingredients.map((row) => isPreparedOutput(row) && row.preparationId === preparationId ? { ...row, name: value || '预调成品' } : row)
  return next
}

function applyAdvanceMaterialSelection(form, preparationId, index, material) {
  const next = cloneForm(form)
  const preparationIndex = next.advancePreparations.findIndex(({ id }) => id === preparationId)
  if (preparationIndex === -1) return next
  const shadow = { ...next, advancePreparations: [], ingredients: next.advancePreparations[preparationIndex].ingredients }
  next.advancePreparations[preparationIndex].ingredients = applyMaterialSelection(shadow, index, material).ingredients
  return next
}

function removeAdvancePreparation(form, preparationId) {
  const next = cloneForm(form)
  next.advancePreparations = next.advancePreparations.filter(({ id }) => id !== preparationId)
  next.ingredients = next.ingredients.filter((row) => !isPreparedOutput(row) || row.preparationId !== preparationId)
  return next
}

function findSpirit(spirit) {
  const name = typeof spirit === 'string' ? spirit : spirit && spirit.name
  return QUICK_BASE_SPIRITS.find((item) => item.name === name || item.id === (spirit && spirit.id)) || QUICK_BASE_SPIRITS[0]
}

function applyQuickBase(form, spirit) {
  const next = cloneForm(form); const selected = findSpirit(spirit)
  const index = next.ingredients.findIndex((item) => item.category === 'base-spirit')
  const base = { ...createIngredientDraft('base-spirit', selected.name), ...(index === -1 ? {} : { renderKey: next.ingredients[index].renderKey }), abv: 40, alcoholic: true, unit: 'ml' }
  if (index === -1) next.ingredients.push(base); else next.ingredients.splice(index, 1, base)
  next.ingredients = next.ingredients.filter((item, itemIndex) => item.category !== 'base-spirit' || itemIndex === next.ingredients.findIndex((row) => row.category === 'base-spirit'))
  if (!next.ingredientOrderCustomized) next.ingredients = sortIngredientsByDefault(next.ingredients)
  return next
}

function replaceIngredientName(form, index, name) {
  const next = cloneForm(form); const prior = next.ingredients[index]
  if (!prior) return next
  let category = prior.category
  if (name === '柠檬汁' || name === '青柠汁') category = 'citrus'
  if (/糖浆$/.test(name) || name === '糖浆') category = 'syrup/staple'
  const replacement = createIngredientDraft(category, name)
  next.ingredients[index] = { ...replacement, renderKey: prior.renderKey, amount: prior.amount, unit: prior.unit, observation: prior.observation || '' }
  return next
}

function amountText(row) { return row && row.amount !== null && row.amount !== undefined ? String(row.amount).trim() : '' }
function amountFor(row) { return amountText(row) ? Number(amountText(row)) : null }
function hasName(row) { return row && String(row.name || '').trim() }
function hasValidIngredientAmount(row) {
  if (['top-up', 'to-taste'].includes(row && row.unit)) return true
  const amount = amountText(row)
  if (!amount) return false
  const numeric = Number(amount)
  return !Number.isFinite(numeric) || numeric > 0
}
function usableIngredient(row) { return hasName(row) && hasValidIngredientAmount(row) }
function hasSuppliedAbv(value) { return value !== null && value !== undefined && String(value).trim() !== '' }
function hasValidAbv(value) { const abv = Number(value); return Number.isFinite(abv) && abv > 0 && abv <= 100 }

function normalizeAndValidateForm(input) {
  const form = cloneForm(input); const errors = {}
  form.name = String(form.name || '').trim()
  form.ingredients = (Array.isArray(form.ingredients) ? form.ingredients : []).map((row) => ({ ...row, name: String(row.name || '').trim() }))
  form.preparations = (Array.isArray(form.preparations) ? form.preparations : []).map((item) => {
    if (!item || typeof item !== 'object') return item
    if (item.type === '即调') return { type: item.type, ...(item.note ? { note: item.note } : {}) }
    const { amount, amountEnd, unit, durationUnit, ...rest } = item
    return { ...rest, durationText: getPreparationDurationText(item) }
  })
  const normalizedPreps = normalizePrepSelections(form.preparations)
  form.preparations = normalizedPreps
  if (!form.name) errors.name = '请填写酒名'
  const preparationIds = new Set(form.advancePreparations.map(({ id }) => id))
  if (form.ingredients.some((row) => row && row.orphanedMaterialId)) errors.ingredients = '有材料已删除，请重新选择或填写材料'
  if (form.ingredients.some((row) => isPreparedOutput(row) && !preparationIds.has(row.preparationId))) errors.ingredients = '有预调材料已失效，请重新添加'
  if (!form.ingredients.some(usableIngredient)) errors.ingredients = '请至少填写一种有效材料和用量'
  if (form.ingredients.some((row) => hasName(row) && !hasValidIngredientAmount(row))) errors.ingredients = '请填写有效的材料用量'
  if (form.ingredients.some((row) => row && row.alcoholic && hasSuppliedAbv(row.abv) && !hasValidAbv(row.abv))) errors.ingredients = '酒精度需大于 0 且不超过 100'
  if (form.preparations.length === 0 || form.preparations.some((prep) => !PREP_TYPES.includes(prep.type))) errors.preparations = '请选择制作方式'
  if (form.advancePreparations.length) {
    form.advancePreparations = form.advancePreparations.map((preparation) => ({ ...preparation, outputName: String(preparation.outputName || '').trim(), steps: String(preparation.steps || '').trim(), ingredients: (Array.isArray(preparation.ingredients) ? preparation.ingredients : []).map((row) => ({ ...row, name: String(row.name || '').trim() })) }))
    if (form.advancePreparations.some(({ outputName }) => !outputName)) errors.advancePreparation = '请填写每一种预调成品名称'
    if (form.advancePreparations.some(({ ingredients }) => ingredients.some((row) => row && row.orphanedMaterialId))) errors.advancePreparation = '有提前准备材料已删除，请重新选择'
    if (form.advancePreparations.some(({ ingredients }) => !ingredients.some(usableIngredient))) errors.advancePreparation = '每一种预调成品都需至少一种材料和用量'
    if (form.advancePreparations.some(({ ingredients }) => ingredients.some((row) => hasName(row) && !hasValidIngredientAmount(row)))) errors.advancePreparation = '请填写有效的提前准备材料用量'
    if (form.advancePreparations.some(({ ingredients }) => ingredients.some((row) => row && row.alcoholic && hasSuppliedAbv(row.abv) && !hasValidAbv(row.abv)))) errors.advancePreparation = '提前准备材料酒精度需大于 0 且不超过 100'
  }
  if (form.orphanGlasswareId) errors.equipment = '酒杯资料缺失，请重新选择或取消后保存'
  return { valid: Object.keys(errors).length === 0, errors, form }
}

function ingredientAmount(row) {
  if (['top-up', 'to-taste'].includes(row.unit)) return null
  const amount = amountText(row)
  const numeric = Number(amount)
  return Number.isFinite(numeric) ? numeric : amount
}
function createMaterialDraftKey(category, name) { return getMaterialIdentityKey(category, name) }
function materialDraft(row) {
  const defaults = { ...createIngredientDraft(row.category, row.name) }
  delete defaults.renderKey
  const name = String(row.name || '').trim()
  return { ...defaults, name, category: defaults.category, defaultUnit: row.unit || defaults.unit, alcoholic: row.alcoholic === true, abv: hasSuppliedAbv(row.abv) ? Number(row.abv) : null, draftKey: createMaterialDraftKey(defaults.category, name) }
}

function buildRecipePayload(input) {
  const result = normalizeAndValidateForm(input); const form = result.form
  if (!result.valid) throw new RangeError(Object.values(result.errors)[0] || 'Invalid recipe form')
  const ingredients = form.ingredients.filter(usableIngredient)
  const regularIngredients = ingredients.filter((row) => !isPreparedOutput(row))
  const historicalObservations = (Array.isArray(form.materialObservations) ? form.materialObservations : [])
    .filter((item) => item && typeof item.materialId === 'string' && item.materialId && typeof item.note === 'string' && item.note.trim())
    .map((item) => ({ materialId: item.materialId, note: item.note.trim(), ...(typeof item.createdAt === 'string' && item.createdAt ? { createdAt: item.createdAt } : {}) }))
  const advanceIngredients = form.advancePreparations.flatMap((preparation) => preparation.ingredients.filter(usableIngredient))
  const allIngredients = [...regularIngredients, ...advanceIngredients]
  const materialDrafts = []
  const seenDraftKeys = new Set()
  for (const row of allIngredients.filter((item) => !item.materialId)) {
    const draft = materialDraft(row)
    if (!seenDraftKeys.has(draft.draftKey)) { seenDraftKeys.add(draft.draftKey); materialDrafts.push(draft) }
  }
  return {
    recipe: {
      ...(form.id ? { id: form.id } : {}), name: form.name, imagePath: form.imagePath || '', source: form.source || '', tried: form.tried === true,
      musicNaming: normalizeMusicNaming(form.musicNaming),
      ingredientOrderCustomized: form.ingredientOrderCustomized === true,
      ingredients: ingredients.map((row) => isPreparedOutput(row)
        ? { kind: 'prepared-output', preparationId: row.preparationId, amount: ingredientAmount(row), unit: row.unit || 'ml' }
        : { materialId: row.materialId || '', ...(row.materialId ? {} : { draftKey: materialDraft(row).draftKey }), amount: ingredientAmount(row), unit: row.unit || 'ml' }),
      advancePreparations: form.advancePreparations.map((preparation) => ({
        id: preparation.id, outputName: preparation.outputName,
        ingredients: preparation.ingredients.filter(usableIngredient).map((row) => ({ materialId: row.materialId || '', ...(row.materialId ? {} : { draftKey: materialDraft(row).draftKey }), amount: ingredientAmount(row), unit: row.unit || 'ml' })),
        steps: preparation.steps.split('\n').map((step) => step.trim()).filter(Boolean)
      })),
      preparations: form.preparations, glasswareId: form.glasswareId || null, toolIds: Array.isArray(form.toolIds) ? form.toolIds : [],
      steps: String(form.steps || '').split('\n').map((step) => step.trim()).filter(Boolean), rating: form.rating || null, tastingNote: form.tastingNote || '',
      materialObservations: [...historicalObservations, ...regularIngredients.filter((row) => String(row.observation || '').trim()).map((row) => ({ ...(row.materialId ? { materialId: row.materialId } : { materialId: '', draftKey: materialDraft(row).draftKey }), note: String(row.observation).trim() }))]
    }, materialDrafts,
    materialUpdates: allIngredients.filter((row) => row.materialId && row.abvNeedsPersist && row.alcoholic && Number.isFinite(Number(row.abv)) && Number(row.abv) > 0 && Number(row.abv) <= 100).map((row) => ({ id: row.materialId, abv: Number(row.abv) }))
  }
}

function resolveRecipeMaterialIds(recipe, idsByDraftKey = {}) {
  const source = recipe && typeof recipe === 'object' ? recipe : {}
  const resolve = (item) => item && (item.materialId || idsByDraftKey[item.draftKey] || '')
  return {
    ...source,
    ingredients: (Array.isArray(source.ingredients) ? source.ingredients : []).map((item) => item && item.kind === 'prepared-output' ? { kind: 'prepared-output', preparationId: item.preparationId, amount: item.amount, unit: item.unit } : { materialId: resolve(item), amount: item.amount, unit: item.unit }),
    advancePreparations: (Array.isArray(source.advancePreparations) ? source.advancePreparations : []).map((preparation) => ({ ...preparation, ingredients: (Array.isArray(preparation.ingredients) ? preparation.ingredients : []).map((item) => ({ materialId: resolve(item), amount: item.amount, unit: item.unit })) })),
    materialObservations: (Array.isArray(source.materialObservations) ? source.materialObservations : []).map((item) => ({ materialId: resolve(item), note: item.note, ...(typeof item.createdAt === 'string' && item.createdAt ? { createdAt: item.createdAt } : {}) })).filter((item) => item.materialId)
  }
}

function getGlasswareSelection(glassware, glasswareId) {
  const list = Array.isArray(glassware) ? glassware : []
  const glasswareIndex = list.findIndex((item) => item && item.id === glasswareId)
  return glasswareIndex === -1 ? { glasswareIndex: 0, glasswareLabel: '选择酒杯' } : { glasswareIndex, glasswareLabel: formatGlasswareLabel(list[glasswareIndex]) }
}

function getFormPreview(form) {
  if (form && Array.isArray(form.advancePreparations) && form.advancePreparations.length) return { status: 'prepared', abv: null, liquidVolume: 0, missing: [], ignored: [] }
  const rows = Array.isArray(form && form.ingredients) ? form.ingredients : []
  return calculateAbv(rows.filter(usableIngredient).map((row) => ({ ...row, amount: ingredientAmount(row) })))
}

function getMissingAlcoholAbvHint(form) {
  if (form && Array.isArray(form.advancePreparations) && form.advancePreparations.length) return '含本配方预调成品，暂不计算酒精度'
  const rows = Array.isArray(form && form.ingredients) ? form.ingredients : []
  const names = [...new Set(rows.filter((row) => row && row.alcoholic === true && hasName(row) && !hasValidAbv(row.abv)).map((row) => String(row.name).trim()))]
  return names.length ? `补充「${names.join('、')}」的酒精度后，即可估算整杯酒精度。` : ''
}

function hydrateEquipmentSelections(form, glassware = [], tools = []) {
  const source = cloneForm(form)
  const glasswareItems = Array.isArray(glassware) ? glassware : []
  const toolItems = Array.isArray(tools) ? tools : []
  const selectedGlass = glasswareItems.find((item) => item && item.id === source.glasswareId)
  const orphanGlasswareId = source.glasswareId && !selectedGlass ? source.glasswareId : ''
  const glasswareOptions = [{ id: '', name: '不选择酒杯' }, ...glasswareItems.map((item) => ({ ...item, name: formatGlasswareLabel(item) }))]
  if (orphanGlasswareId) glasswareOptions.push({ id: orphanGlasswareId, name: `酒杯资料缺失（${orphanGlasswareId}）`, orphaned: true })
  const glasswareIndex = Math.max(0, glasswareOptions.findIndex((item) => item.id === (source.glasswareId || '')))
  const knownToolIds = new Set(toolItems.map((item) => item && item.id).filter(Boolean))
  const orphanToolIds = (Array.isArray(source.toolIds) ? source.toolIds : []).filter((id) => !knownToolIds.has(id))
  const displayTools = [
    ...toolItems,
    ...orphanToolIds.map((id) => ({ id, name: `用具资料缺失（${id}）`, builtIn: false, orphaned: true }))
  ].map((tool) => ({ ...tool, selected: source.toolIds.includes(tool.id) }))
  const hydratedForm = { ...source, orphanGlasswareId, orphanToolIds }
  return {
    form: hydratedForm,
    glasswareOptions,
    glasswareIndex,
    glasswareLabel: selectedGlass ? formatGlasswareLabel(selectedGlass) : glasswareOptions[glasswareIndex].name,
    tools: displayTools,
    hasOrphans: Boolean(orphanGlasswareId || orphanToolIds.length),
    capacity: calculateGlassCapacity(source.ingredients.filter(usableIngredient), selectedGlass || null)
  }
}

function orchestrateRecipeSave({ repository, form, notify = () => {}, navigateBack = () => {} } = {}) {
  const checked = normalizeAndValidateForm(form)
  if (!checked.valid) { notify(Object.values(checked.errors)[0]); return { saved: false, form: checked.form, errors: checked.errors } }
  const payload = buildRecipePayload(checked.form)
  return settleOperation(() => repository.saveRecipeWithMaterials(payload.recipe, payload.materialDrafts, payload.materialUpdates), (recipe) => {
    if (!recipe || !recipe.id) throw new Error('Recipe not saved')
    navigateBack()
    return { saved: true, recipe, form: checked.form, errors: {} }
  }, () => {
    notify('保存失败，请重试')
    return { saved: false, form: checked.form, errors: { form: '保存失败，请重试' } }
  })
}

module.exports = { createEmptyRecipeForm, applyQuickBase, applyMaterialSelection, reorderIngredient, createAdvancePreparation, updateAdvancePreparation, applyAdvanceMaterialSelection, removeAdvancePreparation, replaceIngredientName, createIngredientDraft, hydrateRecipeIngredient, hydrateEquipmentSelections, updateTriedState, updateIngredientField, selectExistingIngredient, normalizeAndValidateForm, buildRecipePayload, resolveRecipeMaterialIds, getGlasswareSelection, getFormPreview, getMissingAlcoholAbvHint, orchestrateRecipeSave }
