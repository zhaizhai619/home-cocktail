const { RATINGS, UNITS } = require('../../domain/constants')
const { calculateAbv } = require('../../domain/abv')
const { getMaterialVisualState } = require('../../domain/material')
const { normalizePrepSelections } = require('../../domain/recipe')

const UNIT_LABELS = UNITS.reduce((labels, unit) => {
  labels[unit.value] = unit.label
  return labels
}, {})

function asLookup(items) {
  return (Array.isArray(items) ? items : []).reduce((lookup, item) => {
    if (item && typeof item.id === 'string' && item.id) lookup[item.id] = item
    return lookup
  }, {})
}

function formatNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? String(numeric) : ''
}

function formatAmount(ingredient) {
  if (!ingredient || ingredient.unit === 'top-up') return ingredient && ingredient.unit === 'top-up' ? '补满' : ''
  const amount = formatNumber(ingredient.amount)
  return amount ? `${amount}${UNIT_LABELS[ingredient.unit] || ingredient.unit || ''}` : (UNIT_LABELS[ingredient.unit] || '')
}

function formatPreparation(preparation) {
  if (preparation.type === '即调') return '即调'
  const unit = ['day', 'days', '天'].includes(preparation.unit) ? '天' : '小时'
  return `${preparation.type} · 提前${formatNumber(preparation.amount)}${unit}`
}

function formatDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) return ''
  return value.slice(0, 10)
}

function buildIngredient(ingredient, materialsById) {
  const source = ingredient && typeof ingredient === 'object' ? ingredient : {}
  const material = materialsById[source.materialId]
  if (!material) {
    return {
      materialId: source.materialId || '', name: '缺失材料', amountLabel: formatAmount(source),
      state: 'missing-long-term', stateLabel: '资料缺失', unavailable: true, orphaned: true
    }
  }
  const state = getMaterialVisualState(material)
  const stateLabels = { owned: '手头有', 'quick-buy': '随买随用', 'missing-long-term': '暂时没有' }
  return {
    materialId: material.id, name: material.name || '未命名材料', amountLabel: formatAmount(source),
    state, stateLabel: stateLabels[state] || '', unavailable: state !== 'owned', orphaned: false
  }
}

function buildAbv(recipe, materialsById) {
  const enriched = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map((ingredient) => {
    const source = ingredient && typeof ingredient === 'object' ? ingredient : {}
    const material = materialsById[source.materialId]
    if (!material) return { name: '缺失材料', unit: 'unknown', alcoholic: true }
    const numericAbv = Number(material.abv)
    const hasAbv = material.abv !== null && material.abv !== undefined && String(material.abv).trim() !== '' && Number.isFinite(numericAbv)
    return {
      name: material.name || '未命名材料', amount: source.amount, unit: source.unit,
      alcoholic: material.alcoholic === true, abv: hasAbv ? numericAbv : null,
      form: material.form
    }
  })
  const result = calculateAbv(enriched)
  return {
    status: result.status,
    valueLabel: result.status === 'ok' ? `${result.abv}%` : '--',
    liquidVolumeLabel: `${result.liquidVolume}ml`,
    missingText: (result.missing || []).join('、')
  }
}

function buildRecipeDetail(recipe, materials = [], glassware = [], tools = []) {
  if (!recipe || typeof recipe !== 'object' || !recipe.id) {
    return { status: 'missing', message: '没有找到这款酒，它可能已被删除' }
  }
  const materialsById = asLookup(materials)
  const glasswareById = asLookup(glassware)
  const toolsById = asLookup(tools)
  const selectedGlass = glasswareById[recipe.glasswareId]
  const preparations = normalizePrepSelections(recipe.preparations).map((preparation) => ({
    ...preparation, label: formatPreparation(preparation), note: typeof preparation.note === 'string' ? preparation.note : ''
  }))
  const observations = (Array.isArray(recipe.materialObservations) ? recipe.materialObservations : []).reduce((items, observation) => {
    if (!observation || typeof observation.note !== 'string' || !observation.note.trim()) return items
    const material = materialsById[observation.materialId]
    items.push({
      materialId: observation.materialId || '', materialName: material && material.name || '缺失材料',
      note: observation.note.trim(), createdAtLabel: formatDate(observation.createdAt)
    })
    return items
  }, [])
  const ingredientOptions = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).reduce((items, ingredient) => {
    const material = ingredient && materialsById[ingredient.materialId]
    if (material && !items.some((item) => item.id === material.id)) items.push({ id: material.id, name: material.name })
    return items
  }, [])

  return {
    status: 'ok', id: recipe.id, name: typeof recipe.name === 'string' ? recipe.name : '',
    imagePath: typeof recipe.imagePath === 'string' ? recipe.imagePath : '', source: typeof recipe.source === 'string' ? recipe.source : '',
    tried: recipe.tried === true, preparations,
    ingredients: (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map((ingredient) => buildIngredient(ingredient, materialsById)),
    ingredientOptions,
    glassware: selectedGlass ? { id: selectedGlass.id, name: selectedGlass.name || '未命名杯具', capacityLabel: Number.isFinite(Number(selectedGlass.capacity || selectedGlass.capacityMl)) ? `${Number(selectedGlass.capacity || selectedGlass.capacityMl)}ml` : '' } : null,
    tools: (Array.isArray(recipe.toolIds) ? recipe.toolIds : []).map((id) => toolsById[id]).filter(Boolean).map((tool) => ({ id: tool.id, name: tool.name || '未命名用具' })),
    steps: (Array.isArray(recipe.steps) ? recipe.steps : []).filter((step) => typeof step === 'string' && step.trim()).map((step) => step.trim()),
    rating: RATINGS.includes(recipe.rating) ? recipe.rating : '', ratings: RATINGS.map((label) => ({ label, selected: label === recipe.rating })),
    tastingNote: typeof recipe.tastingNote === 'string' ? recipe.tastingNote : '',
    observations, abv: buildAbv(recipe, materialsById)
  }
}

function validateObservation(recipe, materialId, note) {
  if (!materialId) return { valid: false, message: '请选择要记录的材料' }
  const ingredients = Array.isArray(recipe && recipe.ingredients) ? recipe.ingredients : []
  if (!ingredients.some((ingredient) => ingredient && ingredient.materialId === materialId)) return { valid: false, message: '只能记录这款酒配方中的材料' }
  const normalizedNote = String(note || '').trim()
  if (!normalizedNote) return { valid: false, message: '请填写本次材料观察' }
  return { valid: true, materialId, note: normalizedNote }
}

function orchestrateObservationSave({ repository, recipe, materialId, note, notify = () => {} }) {
  const validation = validateObservation(recipe, materialId, note)
  if (!validation.valid) { notify(validation.message); return { saved: false, recipe: null } }
  try {
    const saved = repository && repository.appendRecipeObservation(recipe.id, { materialId: validation.materialId, note: validation.note })
    if (!saved) throw new Error('Observation not saved')
    notify('观察已保存')
    return { saved: true, recipe: saved }
  } catch (_) {
    notify('保存失败，请重试')
    return { saved: false, recipe: null }
  }
}

function orchestrateRecipeCopy({ repository, recipeId, notify = () => {} }) {
  try {
    const copy = repository && repository.duplicateRecipe(recipeId)
    if (!copy || !copy.id) throw new Error('Recipe not copied')
    notify('已创建副本')
    return { copied: true, recipeId: copy.id }
  } catch (_) {
    notify('复制失败，请重试')
    return { copied: false, recipeId: '' }
  }
}

function orchestrateRecipeDelete({ repository, recipeId, notify = () => {} }) {
  try {
    const deleted = repository && repository.deleteRecipe(recipeId)
    if (!deleted) throw new Error('Recipe not deleted')
    return { deleted: true }
  } catch (_) {
    notify('删除失败，请重试')
    return { deleted: false }
  }
}

module.exports = {
  buildRecipeDetail,
  validateObservation,
  orchestrateObservationSave,
  orchestrateRecipeCopy,
  orchestrateRecipeDelete
}
