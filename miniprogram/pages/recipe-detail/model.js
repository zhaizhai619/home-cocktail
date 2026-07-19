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
  if (value === null || value === undefined || String(value).trim() === '') return ''
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
  const amountLabel = formatAmount(source)
  if (!material) {
    const name = `缺失材料（${source.materialId || '未知'}）`
    return {
      materialId: source.materialId || '', name, amount: source.amount, unit: source.unit || '', amountLabel,
      state: 'missing-long-term', accessibilityLabel: [name, '材料资料缺失', amountLabel].filter(Boolean).join('，'), orphaned: true
    }
  }
  const state = getMaterialVisualState(material)
  const accessibilityStates = { owned: '材料已在手头', 'quick-buy': '材料可随买随用', 'missing-long-term': '材料暂时没有' }
  const name = material.name || '未命名材料'
  return {
    materialId: material.id, name, amount: source.amount, unit: source.unit || '', amountLabel,
    state, accessibilityLabel: [name, accessibilityStates[state], amountLabel].filter(Boolean).join('，'), orphaned: false
  }
}

function appendUnique(items, value) {
  if (value && !items.includes(value)) items.push(value)
}

function normalizedAmount(value) {
  if (value === null || value === undefined || String(value).trim() === '') return value
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : value
}

function buildAbv(recipe, materialsById) {
  const missingMaterials = []
  const missingAbv = []
  const missingAmount = []
  const enriched = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map((ingredient) => {
    if (!ingredient || typeof ingredient !== 'object') return null
    const source = ingredient && typeof ingredient === 'object' ? ingredient : {}
    const material = materialsById[source.materialId]
    const amount = normalizedAmount(source.amount)
    if (!material) {
      const name = `缺失材料（${source.materialId || '未知'}）`
      appendUnique(missingMaterials, name)
      return { name, amount, unit: source.unit, alcoholic: true, abv: null }
    }
    const name = material.name || '未命名材料'
    const numericAbv = Number(material.abv)
    const hasAbv = material.abv !== null && material.abv !== undefined && String(material.abv).trim() !== '' && Number.isFinite(numericAbv) && numericAbv >= 0 && numericAbv <= 100
    const hasMlAmount = source.unit === 'ml' && Number.isFinite(amount) && amount >= 0
    if (source.unit === 'ml' && !hasMlAmount) appendUnique(missingAmount, name)
    if (source.unit !== 'ml' && source.unit !== 'top-up' && material.alcoholic === true) appendUnique(missingAmount, name)
    if (source.unit === 'top-up' && material.alcoholic === true) appendUnique(missingAmount, name)
    if (hasMlAmount && material.alcoholic === true && !hasAbv) appendUnique(missingAbv, name)
    return {
      name, amount, unit: source.unit,
      alcoholic: material.alcoholic === true, abv: hasAbv ? numericAbv : null,
      form: material.form
    }
  })
  const result = calculateAbv(enriched)
  const explained = new Set([...missingMaterials, ...missingAbv, ...missingAmount])
  for (const name of result.missing || []) {
    if (!explained.has(name)) appendUnique(missingAmount, name)
  }
  const issueLines = []
  if (missingMaterials.length) issueLines.push({ kind: 'material', text: `材料资料缺失：${missingMaterials.join('、')}` })
  if (missingAbv.length) issueLines.push({ kind: 'abv', text: `缺少酒精度：${missingAbv.join('、')}` })
  if (missingAmount.length) issueLines.push({ kind: 'amount', text: `缺少可计算用量：${missingAmount.join('、')}` })
  return {
    status: result.status,
    valueLabel: result.status === 'ok' ? `${result.abv}%` : '--',
    liquidVolumeLabel: `${result.liquidVolume}ml`,
    missing: [...(result.missing || [])],
    ignored: [...(result.ignored || [])],
    issueLines,
    ignoredText: result.ignored && result.ignored.length ? `未计入非 ml 材料：${result.ignored.join('、')}` : '',
    needsEditing: result.status === 'missing'
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
