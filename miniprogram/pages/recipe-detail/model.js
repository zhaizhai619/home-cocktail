const { RATINGS, UNITS } = require('../../domain/constants')
const { analyzeLiquidVolume, calculateAbv, recipeIngredientsForAbv } = require('../../domain/abv')
const { getMaterialDisplayName, getMaterialVisualState } = require('../../domain/material')
const { getPreparationDurationText, normalizePrepSelections, sortIngredientsByDefault } = require('../../domain/recipe')
const { calculateGlassCapacity } = require('../../domain/equipment')
const { isValidGlassCapacity } = require('../../domain/equipment-invariants')
const { settleOperation } = require('../../services/maybe-promise')

const UNIT_LABELS = UNITS.reduce((labels, unit) => {
  labels[unit.value] = unit.label
  return labels
}, {})

function asLookup(items) {
  return (Array.isArray(items) ? items : []).reduce((lookup, item) => {
    if (item && typeof item.id === 'string' && item.id) lookup[item.id] = item
    return lookup
  }, Object.create(null))
}

function formatNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return ''
  const text = String(value).trim()
  const numeric = Number(text)
  return Number.isFinite(numeric) ? String(numeric) : text
}

function formatAmount(ingredient) {
  if (!ingredient || ingredient.unit === 'top-up') return ingredient && ingredient.unit === 'top-up' ? '补满' : ''
  const amount = formatNumber(ingredient.amount)
  return amount ? `${amount}${UNIT_LABELS[ingredient.unit] || ingredient.unit || ''}` : (UNIT_LABELS[ingredient.unit] || '')
}

function formatPreparation(preparation) {
  if (preparation.type === '即调') return '即调'
  const duration = getPreparationDurationText(preparation)
  return `${preparation.type} · ${duration.startsWith('提前') ? duration : `提前${duration}`}`
}

function formatDate(value, offsetMinutes) {
  if (value === null || value === undefined || value === '') return ''
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  let year
  let month
  let day
  if (Number.isFinite(offsetMinutes)) {
    const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000)
    year = shifted.getUTCFullYear()
    month = shifted.getUTCMonth() + 1
    day = shifted.getUTCDate()
  } else {
    year = date.getFullYear()
    month = date.getMonth() + 1
    day = date.getDate()
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function decodeRecipeId(value) {
  if (typeof value !== 'string' || !value) return ''
  try { return decodeURIComponent(value) } catch (_) { return '' }
}

function buildIngredient(ingredient, materialsById, preparationsById = {}) {
  const source = ingredient && typeof ingredient === 'object' ? ingredient : {}
  if (source.kind === 'prepared-output') {
    const preparation = preparationsById[source.preparationId]
    const name = String(preparation && preparation.outputName || '预调成品').trim() || '预调成品'
    const amountLabel = formatAmount(source)
    return {
      materialId: '',
      preparationId: source.preparationId || '',
      name,
      amount: source.amount,
      unit: source.unit || '',
      amountLabel,
      state: 'prepared',
      accessibilityLabel: [name, amountLabel].filter(Boolean).join('，'),
      prepared: true,
      ...(preparation ? {
        preparation: {
          id: preparation.id,
          ingredients: preparation.ingredients,
          steps: preparation.steps,
          hasSteps: preparation.steps.length > 0
        }
      } : {})
    }
  }
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
  const name = getMaterialDisplayName(material.category, material.name) || '未命名材料'
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
  if (recipe && Array.isArray(recipe.advancePreparations) && recipe.advancePreparations.length) return {
    status: 'prepared', valueLabel: '--', liquidVolumeLabel: '--', missing: [], ignored: [],
    issueLines: [{ kind: 'prepared', text: '含本配方预调成品，暂不计算酒精度' }], ignoredText: '', needsEditing: false
  }
  const missingMaterials = []
  const missingAbv = []
  const missingAbvMaterialIds = []
  const missingAmount = []
  const enriched = recipeIngredientsForAbv(recipe, materialsById).map((row) => (
    row && typeof row === 'object'
      ? { ...row, name: getMaterialDisplayName(row.category, row.name) || row.name }
      : row
  ))
  ;(Array.isArray(recipe.ingredients) ? recipe.ingredients : []).forEach((ingredient) => {
    if (!ingredient || typeof ingredient !== 'object') return null
    const source = ingredient && typeof ingredient === 'object' ? ingredient : {}
    const material = materialsById[source.materialId]
    const amount = normalizedAmount(source.amount)
    if (!material) {
      const name = `缺失材料（${source.materialId || '未知'}）`
      appendUnique(missingMaterials, name)
      return null
    }
    const name = getMaterialDisplayName(material.category, material.name) || '未命名材料'
    const numericAbv = Number(material.abv)
    const hasAbv = material.abv !== null && material.abv !== undefined && String(material.abv).trim() !== '' && Number.isFinite(numericAbv) && numericAbv > 0 && numericAbv <= 100
    const hasMlAmount = source.unit === 'ml' && Number.isFinite(amount) && amount >= 0
    if (source.unit === 'ml' && !hasMlAmount) appendUnique(missingAmount, name)
    if (source.unit !== 'ml' && source.unit !== 'top-up' && material.alcoholic === true) appendUnique(missingAmount, name)
    if (source.unit === 'top-up' && material.alcoholic === true) appendUnique(missingAmount, name)
    if (hasMlAmount && material.alcoholic === true && !hasAbv) {
      appendUnique(missingAbv, name)
      appendUnique(missingAbvMaterialIds, source.materialId)
    }
    return null
  })
  const result = calculateAbv(enriched)
  const volume = analyzeLiquidVolume(enriched)
  const volumeComplete = volume.missing.length === 0
  const resultMissing = result.missing || []
  const resultIgnored = result.ignored || []
  const explained = new Set([...missingMaterials, ...missingAbv, ...missingAmount])
  for (const name of resultMissing) {
    if (!explained.has(name)) appendUnique(missingAmount, name)
  }
  const issueLines = []
  if (missingMaterials.length) issueLines.push({ kind: 'material', text: `材料资料缺失：${missingMaterials.join('、')}` })
  if (missingAbv.length) issueLines.push({ kind: 'abv', text: `缺少酒精度：${missingAbv.join('、')}` })
  if (missingAmount.length) issueLines.push({ kind: 'amount', text: `缺少可计算用量：${missingAmount.join('、')}` })
  return {
    status: result.status,
    valueLabel: result.status === 'ok' ? `${result.abv}%` : '--',
    liquidVolumeLabel: volumeComplete ? `${result.liquidVolume}ml` : '--',
    ...(volumeComplete ? {} : { knownLiquidVolumeText: result.liquidVolume > 0 ? `已知液体至少 ${result.liquidVolume}ml` : '', volumeComplete: false }),
    missing: resultMissing,
    ignored: resultIgnored,
    issueLines,
    ignoredText: resultIgnored.length ? `未计入非 ml 材料：${resultIgnored.join('、')}` : '',
    needsEditing: result.status === 'missing',
    ...(missingAbvMaterialIds.length === 1 && missingMaterials.length === 0 && missingAmount.length === 0
      ? { editMaterialId: missingAbvMaterialIds[0] }
      : {})
  }
}

function manualAbvValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null
}

function validateManualAbv(value) {
  if (value === null || value === undefined || String(value).trim() === '') return { valid: true, value: null, message: '' }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return { valid: false, value: null, message: '酒精度需在 0% 到 100% 之间' }
  return { valid: true, value: numeric, message: '' }
}

function orchestrateManualAbvSave({ repository, recipe, value, notify = () => {} } = {}) {
  const validation = validateManualAbv(value)
  if (!validation.valid) { notify(validation.message); return { saved: false, recipe: null, message: validation.message } }
  return settleOperation(() => repository && recipe && repository.upsertRecipe({ ...recipe, manualAbv: validation.value }), (savedRecipe) => {
    if (!savedRecipe) throw new Error('not saved')
    notify(validation.value === null ? '已恢复自动计算' : '酒精度已更新')
    return { saved: true, recipe: savedRecipe, message: '' }
  }, () => {
    const message = '保存失败，请重试'
    notify(message)
    return { saved: false, recipe: null, message }
  })
}

function buildRecipeDetail(recipe, materials = [], glassware = [], tools = []) {
  if (!recipe || typeof recipe !== 'object' || !recipe.id) {
    return { status: 'missing', message: '没有找到这款酒，它可能已被删除' }
  }
  const materialsById = asLookup(materials)
  const glasswareById = asLookup(glassware)
  const toolsById = asLookup(tools)
  const selectedGlass = glasswareById[recipe.glasswareId]
  const sourceIngredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : []
  const displayedIngredients = recipe.ingredientOrderCustomized === true
    ? sourceIngredients.slice()
    : sortIngredientsByDefault(sourceIngredients, materialsById)
  const preparations = normalizePrepSelections(recipe.preparations).map((preparation) => ({
    ...preparation, label: formatPreparation(preparation), note: typeof preparation.note === 'string' ? preparation.note : ''
  }))
  const observations = (Array.isArray(recipe.materialObservations) ? recipe.materialObservations : []).reduce((items, observation, observationIndex) => {
    if (!observation || typeof observation.note !== 'string' || !observation.note.trim()) return items
    const material = materialsById[observation.materialId]
    items.push({
      materialId: observation.materialId || '', materialName: material ? getMaterialDisplayName(material.category, material.name) : '缺失材料',
      note: observation.note.trim(), createdAtLabel: formatDate(observation.createdAt),
      observationIndex, renderKey: `recipe:${recipe.id}:${observationIndex}`
    })
    return items
  }, [])
  const ingredientOptions = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).reduce((items, ingredient) => {
    const material = ingredient && materialsById[ingredient.materialId]
    if (material && !items.some((item) => item.id === material.id)) items.push({ id: material.id, name: getMaterialDisplayName(material.category, material.name) })
    return items
  }, [])
  const advanceSources = Array.isArray(recipe.advancePreparations) ? recipe.advancePreparations : []
  const advancePreparations = advanceSources.map((advanceSource) => ({
    id: advanceSource.id,
    outputName: String(advanceSource.outputName || '').trim(),
    ingredients: (Array.isArray(advanceSource.ingredients) ? advanceSource.ingredients : []).map((ingredient) => buildIngredient(ingredient, materialsById)),
    steps: (Array.isArray(advanceSource.steps) ? advanceSource.steps : []).filter((step) => typeof step === 'string' && step.trim()).map((step) => step.trim())
  }))
  const preparationsById = advancePreparations.reduce((lookup, preparation) => {
    if (preparation && preparation.id) lookup[preparation.id] = preparation
    return lookup
  }, Object.create(null))
  const steps = (Array.isArray(recipe.steps) ? recipe.steps : []).filter((step) => typeof step === 'string' && step.trim()).map((step) => step.trim())
  const legacyTastingNote = typeof recipe.tastingNote === 'string' ? recipe.tastingNote.trim() : ''
  if (legacyTastingNote && !steps.includes(legacyTastingNote)) steps.push(legacyTastingNote)

  const abv = buildAbv(recipe, materialsById)
  const manualAbv = manualAbvValue(recipe.manualAbv)
  return {
    status: 'ok', id: recipe.id, name: typeof recipe.name === 'string' ? recipe.name : '',
    imagePath: typeof recipe.imagePath === 'string' ? recipe.imagePath : '', source: typeof recipe.source === 'string' ? recipe.source : '',
    tried: recipe.tried === true, preparations,
    ingredients: displayedIngredients.map((ingredient) => buildIngredient(ingredient, materialsById, preparationsById)),
    advancePreparations,
    ingredientOptions,
    glassware: selectedGlass ? {
      id: selectedGlass.id,
      name: selectedGlass.name || '未命名酒杯',
      capacityLabel: isValidGlassCapacity(selectedGlass.capacityMl !== undefined ? selectedGlass.capacityMl : selectedGlass.capacity) ? `${Number(selectedGlass.capacityMl !== undefined ? selectedGlass.capacityMl : selectedGlass.capacity)}ml` : '容量待补充',
      ...(selectedGlass.imagePath ? { imagePath: selectedGlass.imagePath } : {}),
      ...(selectedGlass.notes || selectedGlass.note ? { notes: selectedGlass.notes || selectedGlass.note } : {})
    } : (recipe.glasswareId ? { id: recipe.glasswareId, name: `酒杯资料缺失（${recipe.glasswareId}）`, capacityLabel: '', orphaned: true } : null),
    tools: (Array.isArray(recipe.toolIds) ? recipe.toolIds : []).map((id) => {
      const tool = toolsById[id]
      return tool ? { id: tool.id, name: tool.name || '未命名用具' } : { id, name: `用具资料缺失（${id}）`, orphaned: true }
    }),
    steps,
    rating: RATINGS.includes(recipe.rating) ? recipe.rating : '', ratings: RATINGS.map((label) => ({ label, selected: label === recipe.rating })),
    observations, abv, manualAbv, abvBadgeLabel: manualAbv !== null ? `${manualAbv}%` : (abv.status === 'ok' ? abv.valueLabel : '编辑酒精度'), capacity: calculateGlassCapacity(recipeIngredientsForAbv(recipe, materialsById), selectedGlass || null)
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
  return settleOperation(() => repository && repository.appendRecipeObservation(recipe.id, { materialId: validation.materialId, note: validation.note }), (saved) => {
    if (!saved) throw new Error('Observation not saved')
    notify('观察已保存')
    return { saved: true, recipe: saved }
  }, () => {
    notify('保存失败，请重试')
    return { saved: false, recipe: null }
  })
}

function orchestrateRatingToggle({ repository, recipe, rating, promotedFromUntried = false, notify = () => {} }) {
  const previousPromotionState = promotedFromUntried === true
  if (!recipe || !recipe.id || !RATINGS.includes(rating)) {
    notify('评价选项无效')
    return { saved: false, recipe: null, promotedFromUntried: previousPromotionState }
  }
  const isCancelling = recipe.rating === rating
  const nextPromotionState = isCancelling ? false : (previousPromotionState || recipe.tried !== true)
  const nextRecipe = {
    ...recipe,
    tried: isCancelling ? (previousPromotionState ? false : recipe.tried === true) : true,
    rating: isCancelling ? null : rating
  }
  return settleOperation(() => repository && repository.upsertRecipe(nextRecipe), (saved) => {
    if (!saved) throw new Error('Rating not saved')
    return { saved: true, recipe: saved, promotedFromUntried: nextPromotionState }
  }, () => {
    notify('评价保存失败，请重试')
    return { saved: false, recipe: null, promotedFromUntried: previousPromotionState }
  })
}

function orchestrateRecipeCopy({ repository, recipeId, notify = () => {} }) {
  return settleOperation(() => repository && repository.duplicateRecipe(recipeId), (copy) => {
    if (!copy || !copy.id) throw new Error('Recipe not copied')
    notify('已创建副本')
    return { copied: true, recipeId: copy.id }
  }, () => {
    notify('复制失败，请重试')
    return { copied: false, recipeId: '' }
  })
}

function orchestrateObservationDelete({ repository, recipeId, observationIndex, notify = () => {} } = {}) {
  return settleOperation(() => repository && repository.deleteRecipeObservation(recipeId, observationIndex), (recipe) => {
    if (!recipe) throw new Error('Observation not deleted')
    notify('记录已删除')
    return { deleted: true, recipe }
  }, () => {
    notify('删除失败，请重试')
    return { deleted: false, recipe: null }
  })
}

function orchestrateRecipeDelete({ repository, recipeId, notify = () => {} }) {
  return settleOperation(() => repository && repository.deleteRecipe(recipeId), (deleted) => {
    if (!deleted) throw new Error('Recipe not deleted')
    return { deleted: true }
  }, () => {
    notify('删除失败，请重试')
    return { deleted: false }
  })
}

module.exports = {
  buildRecipeDetail,
  decodeRecipeId,
  formatDate,
  validateObservation,
  orchestrateObservationSave,
  orchestrateObservationDelete,
  orchestrateRatingToggle,
  validateManualAbv,
  orchestrateManualAbvSave,
  orchestrateRecipeCopy,
  orchestrateRecipeDelete
}
