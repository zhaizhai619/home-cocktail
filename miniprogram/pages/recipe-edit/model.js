const { QUICK_BASE_SPIRITS, PREP_TYPES } = require('../../domain/constants')
const { createMaterialDefaults } = require('../../domain/material')
const { normalizePrepSelections } = require('../../domain/recipe')
const { calculateAbv } = require('../../domain/abv')

const EMPTY_INGREDIENT = (category, name) => createIngredientDraft(category, name)

function createIngredientDraft(category, name, material) {
  if (material && typeof material === 'object') {
    return {
      name: material.name || '', category: material.category || 'other-liquid', amount: '',
      unit: material.defaultUnit || 'ml', alcoholic: material.alcoholic === true,
      abv: Number.isFinite(material.abv) ? material.abv : null, materialId: material.id || '',
      status: 'existing', observation: ''
    }
  }
  let defaults
  try { defaults = createMaterialDefaults(category || 'other-liquid', name || '') } catch (_) { defaults = createMaterialDefaults('other-liquid', name || '') }
  return {
    name: name || '', category: defaults.category, amount: '', unit: defaults.defaultUnit,
    alcoholic: defaults.alcoholic === true, abv: Number.isFinite(defaults.abv) ? defaults.abv : null,
    materialId: '', status: 'new', observation: ''
  }
}

function hydrateRecipeIngredient(ingredient, material) {
  const row = ingredient && typeof ingredient === 'object' ? ingredient : {}
  if (material) return { ...createIngredientDraft(null, null, material), amount: row.amount === null ? '' : row.amount, unit: row.unit || material.defaultUnit }
  const orphanedMaterialId = String(row.materialId || '')
  return { ...createIngredientDraft('other-liquid', `缺失材料（${orphanedMaterialId || '未知'}）`), amount: row.amount === null ? '' : row.amount, unit: row.unit || 'ml', materialId: orphanedMaterialId, orphanedMaterialId, status: 'orphaned' }
}

function createEmptyRecipeForm() {
  return {
    id: '', name: '', imagePath: '', source: '', tried: true,
    ingredients: [EMPTY_INGREDIENT('citrus', '柠檬汁'), EMPTY_INGREDIENT('syrup', '糖浆')],
    preparations: [{ type: '即调', amount: '', unit: 'hour', note: '' }],
    glasswareId: '', toolIds: [], steps: '', rating: '', tastingNote: '', materialObservations: []
  }
}

function cloneForm(form) { return JSON.parse(JSON.stringify(form || createEmptyRecipeForm())) }

function updateIngredientField(form, index, field, value) {
  const next = cloneForm(form); const row = next.ingredients[index]
  if (!row) return next
  const locked = row.materialId && !row.orphanedMaterialId && ['name', 'category', 'alcoholic', 'abv'].includes(field)
  if (locked) return next
  next.ingredients[index] = { ...row, [field]: value }
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
  next.ingredients[index] = { ...createIngredientDraft(null, null, material), amount: previous.amount, observation: previous.observation || '' }
  return next
}

function findSpirit(spirit) {
  const name = typeof spirit === 'string' ? spirit : spirit && spirit.name
  return QUICK_BASE_SPIRITS.find((item) => item.name === name || item.id === (spirit && spirit.id)) || QUICK_BASE_SPIRITS[0]
}

function applyQuickBase(form, spirit) {
  const next = cloneForm(form); const selected = findSpirit(spirit)
  const base = { ...createIngredientDraft('base-spirit', selected.name), abv: 40, alcoholic: true, unit: 'ml' }
  const index = next.ingredients.findIndex((item) => item.category === 'base-spirit')
  if (index === -1) next.ingredients.unshift(base); else next.ingredients.splice(index, 1, base)
  next.ingredients = next.ingredients.filter((item, itemIndex) => item.category !== 'base-spirit' || itemIndex === next.ingredients.findIndex((row) => row.category === 'base-spirit'))
  return next
}

function replaceIngredientName(form, index, name) {
  const next = cloneForm(form); const prior = next.ingredients[index]
  if (!prior) return next
  let category = prior.category
  if (name === '柠檬汁' || name === '青柠汁') category = 'citrus'
  if (/糖浆$/.test(name) || name === '糖浆') category = 'syrup/staple'
  const replacement = createIngredientDraft(category, name)
  next.ingredients[index] = { ...replacement, amount: prior.amount, unit: prior.unit, observation: prior.observation || '' }
  return next
}

function amountFor(row) { return typeof row.amount === 'string' && row.amount.trim() === '' ? null : Number(row.amount) }
function hasName(row) { return row && String(row.name || '').trim() }
function usableIngredient(row) { return hasName(row) && (row.unit === 'top-up' || (Number.isFinite(amountFor(row)) && amountFor(row) > 0)) }

function normalizeAndValidateForm(input) {
  const form = cloneForm(input); const errors = {}
  form.name = String(form.name || '').trim()
  form.ingredients = (Array.isArray(form.ingredients) ? form.ingredients : []).map((row) => ({ ...row, name: String(row.name || '').trim() }))
  form.preparations = (Array.isArray(form.preparations) ? form.preparations : []).map((item) => ({ ...item, amount: item.amount === '' ? '' : Number(item.amount) }))
  const normalizedPreps = normalizePrepSelections(form.preparations)
  form.preparations = normalizedPreps
  if (!form.name) errors.name = '请填写酒名'
  if (form.ingredients.some((row) => row && row.orphanedMaterialId)) errors.ingredients = '有材料已删除，请重新选择或填写材料'
  if (!form.ingredients.some(usableIngredient)) errors.ingredients = '请至少填写一种有效材料和用量'
  if (form.ingredients.some((row) => hasName(row) && row.unit !== 'top-up' && (!Number.isFinite(amountFor(row)) || amountFor(row) <= 0))) errors.ingredients = '材料用量需大于 0'
  if (form.preparations.length === 0 || form.preparations.some((prep) => !PREP_TYPES.includes(prep.type) || (prep.type !== '即调' && (!Number.isFinite(prep.amount) || prep.amount <= 0)))) errors.preparations = '预制方式需填写有效时长'
  return { valid: Object.keys(errors).length === 0, errors, form }
}

function ingredientAmount(row) { return row.unit === 'top-up' ? null : amountFor(row) }
function createMaterialDraftKey(category, name) { return `${category}:${String(name || '').trim()}` }
function materialDraft(row) {
  const defaults = createIngredientDraft(row.category, row.name)
  const name = String(row.name || '').trim()
  return { ...defaults, name, category: defaults.category, defaultUnit: row.unit || defaults.unit, alcoholic: row.alcoholic === true, abv: Number.isFinite(Number(row.abv)) ? Number(row.abv) : null, draftKey: createMaterialDraftKey(defaults.category, name) }
}

function buildRecipePayload(input) {
  const result = normalizeAndValidateForm(input); const form = result.form
  const ingredients = form.ingredients.filter(usableIngredient)
  const historicalObservations = (Array.isArray(form.materialObservations) ? form.materialObservations : [])
    .filter((item) => item && typeof item.materialId === 'string' && item.materialId && typeof item.note === 'string' && item.note.trim())
    .map((item) => ({ materialId: item.materialId, note: item.note.trim() }))
  const materialDrafts = []
  const seenDraftKeys = new Set()
  for (const row of ingredients.filter((item) => !item.materialId)) {
    const draft = materialDraft(row)
    if (!seenDraftKeys.has(draft.draftKey)) { seenDraftKeys.add(draft.draftKey); materialDrafts.push(draft) }
  }
  return {
    recipe: {
      ...(form.id ? { id: form.id } : {}), name: form.name, imagePath: form.imagePath || '', source: form.source || '', tried: form.tried === true,
      ingredients: ingredients.map((row) => ({ materialId: row.materialId || '', ...(row.materialId ? {} : { draftKey: materialDraft(row).draftKey }), amount: ingredientAmount(row), unit: row.unit || 'ml' })),
      preparations: form.preparations, glasswareId: form.glasswareId || null, toolIds: Array.isArray(form.toolIds) ? form.toolIds : [],
      steps: String(form.steps || '').split('\n').map((step) => step.trim()).filter(Boolean), rating: form.rating || null, tastingNote: form.tastingNote || '',
      materialObservations: [...historicalObservations, ...ingredients.filter((row) => String(row.observation || '').trim()).map((row) => ({ ...(row.materialId ? { materialId: row.materialId } : { materialId: '', draftKey: materialDraft(row).draftKey }), note: String(row.observation).trim() }))]
    }, materialDrafts
  }
}

function resolveRecipeMaterialIds(recipe, idsByDraftKey = {}) {
  const source = recipe && typeof recipe === 'object' ? recipe : {}
  const resolve = (item) => item && (item.materialId || idsByDraftKey[item.draftKey] || '')
  return {
    ...source,
    ingredients: (Array.isArray(source.ingredients) ? source.ingredients : []).map((item) => ({ materialId: resolve(item), amount: item.amount, unit: item.unit })),
    materialObservations: (Array.isArray(source.materialObservations) ? source.materialObservations : []).map((item) => ({ materialId: resolve(item), note: item.note })).filter((item) => item.materialId)
  }
}

function getGlasswareSelection(glassware, glasswareId) {
  const list = Array.isArray(glassware) ? glassware : []
  const glasswareIndex = list.findIndex((item) => item && item.id === glasswareId)
  return glasswareIndex === -1 ? { glasswareIndex: 0, glasswareLabel: '选择杯具' } : { glasswareIndex, glasswareLabel: list[glasswareIndex].name || '选择杯具' }
}

function getFormPreview(form) {
  const rows = Array.isArray(form && form.ingredients) ? form.ingredients : []
  return calculateAbv(rows.filter(usableIngredient).map((row) => ({ ...row, amount: ingredientAmount(row) })))
}

module.exports = { createEmptyRecipeForm, applyQuickBase, replaceIngredientName, createIngredientDraft, hydrateRecipeIngredient, updateIngredientField, selectExistingIngredient, normalizeAndValidateForm, buildRecipePayload, resolveRecipeMaterialIds, getGlasswareSelection, getFormPreview }
