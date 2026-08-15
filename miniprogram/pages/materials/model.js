const { MATERIAL_CATEGORY_GROUPS, getMaterialCategoryGroup, getMaterialIdentityKey, getMaterialVisualState, isMaterialAvailable, materialNameMatchesQuery } = require('../../domain/material')
const { RATINGS, UNITS } = require('../../domain/constants')
const { getMaterialUsageStats, getRecipesUsingMaterial } = require('../../domain/relations')
const { getMaterialReadiness, getPreparationDurationText, getPrimaryPreparation } = require('../../domain/recipe')
const { formatGlasswareLabel } = require('../../domain/equipment')
const { normalizeEquipmentName } = require('../../domain/equipment-invariants')
const { isValidDateString } = require('../../domain/date')
const { settleOperation } = require('../../services/maybe-promise')

const MATERIAL_LIBRARY_TABS = Object.freeze([
  { key: 'all', label: '全部' },
  ...MATERIAL_CATEGORY_GROUPS.map(({ key, label }) => ({ key, label }))
])

const MATERIAL_LIBRARY_TEMPLATES = Object.freeze([
  { name: '金酒', category: 'base-spirit' },
  { name: '白朗姆', category: 'base-spirit' },
  { name: '威士忌', category: 'base-spirit' },
  { name: '伏特加', category: 'base-spirit' },
  { name: '龙舌兰', category: 'base-spirit' },
  { name: '普通糖浆', category: 'syrup/staple' },
  { name: '接骨木糖浆', category: 'syrup/staple' }
])

const UNIT_LABELS = UNITS.reduce((labels, unit) => {
  labels[unit.value] = unit.label
  return labels
}, {})

function categoryGroup(category) {
  return getMaterialCategoryGroup(category).key
}

function categoryLabel(category) {
  const key = categoryGroup(category)
  return (MATERIAL_LIBRARY_TABS.find((item) => item.key === key) || {}).label || '其他'
}

function asLookup(items) {
  return (Array.isArray(items) ? items : []).reduce((lookup, item) => {
    if (item && typeof item.id === 'string' && item.id) lookup[item.id] = item
    return lookup
  }, {})
}

function formatInventory(material) {
  if (!isMaterialAvailable(material)) return ''
  if (material.trackFreshness !== true) return '当前在手头'
  const hasAmount = material.remainingAmount !== null && material.remainingAmount !== undefined && String(material.remainingAmount).trim() !== ''
  if (hasAmount && Number.isFinite(Number(material.remainingAmount))) {
    const labels = { piece: '个', slice: '片', drop: '滴', chunk: '块', 'top-up': '补满', 'to-taste': '适量' }
    return `还剩约 ${Number(material.remainingAmount)}${labels[material.remainingUnit] || material.remainingUnit || ''}`
  }
  return '当前在手头'
}

const DAY_MS = 24 * 60 * 60 * 1000

function getLocalDateOrdinal(value, offsetMinutes) {
  const dateOnly = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const year = Number(dateOnly[1]); const month = Number(dateOnly[2]); const day = Number(dateOnly[3])
    const timestamp = Date.UTC(year, month - 1, day)
    const checked = new Date(timestamp)
    if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) return null
    return Math.floor(timestamp / DAY_MS)
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  let year; let month; let day
  if (Number.isFinite(offsetMinutes)) {
    const shifted = new Date(date.getTime() + Number(offsetMinutes) * 60 * 1000)
    year = shifted.getUTCFullYear(); month = shifted.getUTCMonth(); day = shifted.getUTCDate()
  } else {
    year = date.getFullYear(); month = date.getMonth(); day = date.getDate()
  }
  return Math.floor(Date.UTC(year, month, day) / DAY_MS)
}

function formatExpiry(value, nowValue, offsetMinutes) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string' && !isValidDateString(value)) return ''
  const expiryOrdinal = getLocalDateOrdinal(value, offsetMinutes)
  const nowOrdinal = getLocalDateOrdinal(nowValue || new Date(), offsetMinutes)
  if (!Number.isFinite(expiryOrdinal) || !Number.isFinite(nowOrdinal)) return ''
  const days = expiryOrdinal - nowOrdinal
  if (days < 0) return `已过期 ${Math.abs(days)} 天`
  if (days === 0) return '今天到期'
  return `${days} 天后到期`
}

function buildCard(material, recipes, materialsById, now) {
  const stats = getMaterialUsageStats(material.id, recipes, materialsById)
  const visualState = getMaterialVisualState(material)
  const inventoryLabel = formatInventory(material)
  const available = isMaterialAvailable(material)
  const expiryLabel = available && material.trackFreshness === true ? formatExpiry(material.expiresAt, now, undefined) : ''
  return {
    ...material,
    renderKey: `material:${material.id}`,
    categoryFilter: categoryGroup(material.category),
    categoryLabel: categoryLabel(material.category),
    isTemplate: false,
    visualState,
    usageCount: stats.usageCount,
    immediateUnlockCount: stats.immediateUnlockCount,
    inventoryLabel,
    expiryLabel,
    inventoryMeta: [inventoryLabel, expiryLabel].filter(Boolean).join(' · '),
    canToggleOwned: material.acquisition === 'long-term',
    canAddFresh: material.acquisition === 'on-demand' && material.freshOnHand !== true,
    isFreshShelf: material.acquisition === 'on-demand' && material.freshOnHand === true && material.trackFreshness === true
  }
}

function formatRecipePreparation(recipe) {
  const primary = getPrimaryPreparation(recipe && recipe.preparations)
  if (!primary) return ''
  if (primary.type === '即调') return '即调'
  const duration = getPreparationDurationText(primary)
  if (!duration) return primary.type
  return `${primary.type} · ${duration.startsWith('提前') ? duration : `提前${duration}`}`
}

function getRecipeRatingRank(recipe) {
  const ratingIndex = recipe && recipe.tried === true ? RATINGS.indexOf(recipe.rating) : -1
  return ratingIndex < 0 ? RATINGS.length : ratingIndex
}

function getRecipeLeadHours(recipe) {
  const primary = getPrimaryPreparation(recipe && recipe.preparations)
  return primary ? primary.leadHours : 0
}

function recipeMaterialIngredients(recipe) {
  const servingIngredients = (Array.isArray(recipe && recipe.ingredients) ? recipe.ingredients : [])
    .filter((ingredient) => ingredient && ingredient.kind !== 'prepared-output')
  const advanceIngredients = (Array.isArray(recipe && recipe.advancePreparations) ? recipe.advancePreparations : [])
    .flatMap((preparation) => Array.isArray(preparation && preparation.ingredients) ? preparation.ingredients : [])
  return [...servingIngredients, ...advanceIngredients]
}

function formatRecipeMaterialAmount(recipe, materialId) {
  const groups = recipeMaterialIngredients(recipe)
    .filter((ingredient) => ingredient.materialId === materialId)
    .reduce((result, ingredient) => {
      const unit = String(ingredient.unit || '')
      let group = result.find((item) => item.unit === unit)
      if (!group) {
        group = { unit, amounts: [] }
        result.push(group)
      }
      group.amounts.push(ingredient.amount)
      return result
    }, [])

  if (!groups.length) return ''
  return groups.map(({ unit, amounts }) => {
    if (unit === 'top-up') return '补满'
    if (unit === 'to-taste') return '适量'
    const filled = amounts.filter((amount) => amount !== null && amount !== undefined && String(amount).trim() !== '')
    if (!filled.length) return '未记录用量'
    const numeric = filled.map(Number)
    const unitLabel = UNIT_LABELS[unit] || unit
    if (numeric.every(Number.isFinite)) return `${numeric.reduce((sum, amount) => sum + amount, 0)}${unitLabel}`
    return filled.map((amount) => `${String(amount).trim()}${unitLabel}`).join(' + ')
  }).join(' + ')
}

function buildFreshRecipeSummaries(material, recipes, materialsById, freshMaterialIds) {
  return getRecipesUsingMaterial(material.id, recipes)
    .map((recipe, index) => {
      const ingredients = recipeMaterialIngredients(recipe)
      const freshHitCount = new Set(
        ingredients
          .map((ingredient) => ingredient && ingredient.materialId)
          .filter((materialId) => freshMaterialIds.has(materialId))
      ).size
      const unitMatchesRemaining = Boolean(material.remainingUnit) &&
        ingredients.some((ingredient) => ingredient && ingredient.materialId === material.id && ingredient.unit === material.remainingUnit)
      return {
        recipe,
        index,
        freshHitCount,
        ready: getMaterialReadiness(recipe, materialsById) === 'on-hand',
        unitMatchesRemaining
      }
    })
    .sort((first, second) => (
      second.freshHitCount - first.freshHitCount ||
      Number(!first.ready) - Number(!second.ready) ||
      Number(!first.unitMatchesRemaining) - Number(!second.unitMatchesRemaining) ||
      getRecipeRatingRank(first.recipe) - getRecipeRatingRank(second.recipe) ||
      getRecipeLeadHours(first.recipe) - getRecipeLeadHours(second.recipe) ||
      String(second.recipe.createdAt || '').localeCompare(String(first.recipe.createdAt || '')) ||
      first.index - second.index
    ))
    .map(({ recipe }, index) => ({
      id: recipe.id,
      name: recipe.name,
      rating: recipe.tried === true && RATINGS.includes(recipe.rating) ? recipe.rating : '',
      preparationLabel: formatRecipePreparation(recipe),
      materialAmountLabel: formatRecipeMaterialAmount(recipe, material.id),
      recommended: index === 0
    }))
}

function compactDateLabel(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.slice(5)
    : ''
}

function freshRemainingLabel(card) {
  const hasAmount = card.remainingAmount !== null &&
    card.remainingAmount !== undefined &&
    String(card.remainingAmount).trim() !== '' &&
    Number.isFinite(Number(card.remainingAmount))
  if (!hasAmount) return '填写余量'
  const labels = { piece: '个', slice: '片', drop: '滴', chunk: '块', 'top-up': '补满', 'to-taste': '适量' }
  return `剩余 ${Number(card.remainingAmount)}${labels[card.remainingUnit] || card.remainingUnit || ''}`
}

function freshNeedsReminder(card, nowValue) {
  const nowOrdinal = getLocalDateOrdinal(nowValue || new Date())
  if (!Number.isFinite(nowOrdinal)) return false
  const expiryOrdinal = card.expiresAt ? getLocalDateOrdinal(card.expiresAt) : null
  if (Number.isFinite(expiryOrdinal)) return expiryOrdinal - nowOrdinal <= 1
  const purchaseOrdinal = card.purchasedAt ? getLocalDateOrdinal(card.purchasedAt) : null
  return Number.isFinite(purchaseOrdinal) && nowOrdinal - purchaseOrdinal >= 2
}

function buildFreshCard(card, recipes, materialsById, nowValue, freshMaterialIds) {
  const relatedRecipes = buildFreshRecipeSummaries(card, recipes, materialsById, freshMaterialIds)
  const visibleInventory = card.inventoryLabel === '当前在手头' ? '' : card.inventoryLabel
  const remainingLabel = freshRemainingLabel(card)
  const remainingMissing = remainingLabel === '填写余量'
  const needsReminder = freshNeedsReminder(card, nowValue)
  return {
    ...card,
    purchaseDateLabel: compactDateLabel(card.purchasedAt),
    expiryDateLabel: compactDateLabel(card.expiresAt),
    remainingLabel,
    remainingMissing,
    needsReminder,
    reminderLabel: needsReminder ? remainingLabel : '',
    freshMeta: [visibleInventory, card.expiryLabel].filter(Boolean).join(' · '),
    recommendedRecipe: relatedRecipes[0] || null,
    relatedRecipes
  }
}

function mergeCatalogTemplates(cards) {
  const byIdentity = new Map(cards.map((card) => [getMaterialIdentityKey(card.category, card.name), card]))
  const matchedIds = new Set()
  const templates = MATERIAL_LIBRARY_TEMPLATES.map((template, catalogOrder) => {
    const identity = getMaterialIdentityKey(template.category, template.name)
    const existing = byIdentity.get(identity)
    if (existing) {
      matchedIds.add(existing.id)
      return { ...existing, catalogOrder }
    }
    return {
      ...template,
      id: '',
      renderKey: `template:${identity}`,
      categoryFilter: categoryGroup(template.category),
      categoryLabel: categoryLabel(template.category),
      isTemplate: true,
      visualState: 'missing-long-term',
      isFreshShelf: false,
      inventoryLabel: '',
      expiryLabel: '',
      inventoryMeta: '',
      usageCount: 0,
      immediateUnlockCount: 0,
      catalogOrder
    }
  })
  const extras = cards.filter((card) => !matchedIds.has(card.id)).map((card, index) => ({ ...card, catalogOrder: MATERIAL_LIBRARY_TEMPLATES.length + index }))
  return [...templates, ...extras]
}

function matchesFilter(card, filter) {
  if (filter === 'owned') return card.visualState === 'owned'
  if (filter === 'fresh') return card.isFreshShelf
  if (filter === 'missing') return card.visualState !== 'owned'
  return true
}

function buildMaterialLibrary(materials = [], recipes = [], options = {}) {
  const safeMaterials = Array.isArray(materials) ? materials.filter((item) => item && item.id) : []
  const safeRecipes = Array.isArray(recipes) ? recipes : []
  const materialsById = asLookup(safeMaterials)
  const query = String(options.search || '').trim().toLocaleLowerCase()
  const acquisition = options.acquisition || 'all'
  const cards = safeMaterials.map((material) => buildCard(material, safeRecipes, materialsById, options.now))
  const freshMaterialIds = new Set(cards.filter((card) => card.isFreshShelf).map((card) => card.id))
  const freshShelf = cards
    .filter((card) => card.isFreshShelf)
    .map((card) => buildFreshCard(card, safeRecipes, materialsById, options.now, freshMaterialIds))
  const libraryCards = options.includeCatalog === true ? mergeCatalogTemplates(cards) : cards
  const searchMatchCategoryKeys = query
    ? MATERIAL_LIBRARY_TABS
      .filter(({ key }) => key !== 'all' && libraryCards.some((card) => (
        card.categoryFilter === key &&
        materialNameMatchesQuery(card.category, card.name, query)
      )))
      .map(({ key }) => key)
    : []
  const categoryFilter = MATERIAL_LIBRARY_TABS.some((item) => item.key === options.categoryFilter) ? options.categoryFilter : 'all'
  const filtered = libraryCards.filter((card) => {
    if (query && !materialNameMatchesQuery(card.category, card.name, query)) return false
    if (categoryFilter !== 'all' && card.categoryFilter !== categoryFilter) return false
    if (acquisition !== 'all' && card.acquisition !== acquisition) return false
    return matchesFilter(card, options.filter || 'all')
  })
  const byRecent = (first, second) => String(second.updatedAt || '').localeCompare(String(first.updatedAt || '')) || String(first.name || '').localeCompare(String(second.name || ''), 'zh-CN')
  const byCatalog = (first, second) => Number(first.catalogOrder || 0) - Number(second.catalogOrder || 0) || byRecent(first, second)
  const priorOrder = options.includeCatalog === true ? byCatalog : byRecent
  const categoryOrder = new Map(MATERIAL_CATEGORY_GROUPS.map(({ key }, index) => [key, index]))
  const byCategory = (first, second) => Number(categoryOrder.get(first.categoryFilter) || 0) - Number(categoryOrder.get(second.categoryFilter) || 0)
  const byAvailability = (first, second) => Number(first.visualState !== 'owned') - Number(second.visualState !== 'owned')
  const byUsage = (first, second) => Number(second.usageCount || 0) - Number(first.usageCount || 0)
  const byLibraryPriority = (first, second) => (
    byAvailability(first, second) ||
    (categoryFilter === 'all' ? byCategory(first, second) : 0) ||
    byUsage(first, second) ||
    priorOrder(first, second)
  )
  return {
    freshShelf: freshShelf.sort(byRecent),
    materials: filtered.sort(byLibraryPriority),
    searchMatchCategoryKeys
  }
}

function nextGlasswareName(glassware = []) {
  const names = new Set((Array.isArray(glassware) ? glassware : []).map((item) => normalizeEquipmentName(item && item.name)).filter(Boolean))
  let sequence = 1
  while (names.has(`酒杯${sequence}`)) sequence += 1
  return `酒杯${sequence}`
}

function prepareGlasswareForSave(form = {}, glassware = []) {
  const source = form && typeof form === 'object' ? form : {}
  return { ...source, name: normalizeEquipmentName(source.name) || nextGlasswareName(glassware) }
}

function buildGlasswareCards(glassware = []) {
  return (Array.isArray(glassware) ? glassware : []).filter((item) => item && item.id).map((item) => ({
    ...item,
    displayLabel: formatGlasswareLabel(item)
  }))
}

function ensureLibraryMaterial(repository, card = {}) {
  if (!repository) return null
  if (card.id) {
    const persisted = repository.getMaterial(card.id)
    if (persisted) return persisted
  }
  if (!card.name || !card.category) return null
  const identity = getMaterialIdentityKey(card.category, card.name)
  const existing = repository.listMaterials().find((item) => getMaterialIdentityKey(item.category, item.name) === identity)
  return existing || repository.saveMaterial({ name: card.name, category: card.category, owned: false, assumedAvailable: false, freshOnHand: false })
}

function buildFreshFormState(material = {}) {
  const requestedUnit = material.remainingUnit || material.defaultUnit || 'ml'
  const matchedIndex = UNITS.findIndex(({ value }) => value === requestedUnit)
  const freshUnitIndex = matchedIndex < 0 ? 0 : matchedIndex
  return {
    showFreshForm: true,
    freshError: '',
    freshUnitIndex,
    freshDraft: {
      materialId: String(material.id || ''),
      name: String(material.name || ''),
      trackFreshness: material.trackFreshness === true,
      remainingAmount: material.remainingAmount === null || material.remainingAmount === undefined ? '' : material.remainingAmount,
      remainingUnit: UNITS[freshUnitIndex].value,
      expiresAt: material.expiresAt ? String(material.expiresAt).slice(0, 10) : ''
    }
  }
}

function buildFreshRemainingEditorState(material = {}) {
  const requestedUnit = material.remainingUnit || material.defaultUnit || 'ml'
  const matchedIndex = UNITS.findIndex(({ value }) => value === requestedUnit)
  const remainingUnitIndex = matchedIndex < 0 ? 0 : matchedIndex
  return {
    remainingEditorOpen: true,
    remainingError: '',
    remainingUnitIndex,
    remainingDraft: {
      materialId: String(material.id || ''),
      name: String(material.name || ''),
      remainingAmount: material.remainingAmount === null || material.remainingAmount === undefined
        ? ''
        : material.remainingAmount,
      remainingUnit: UNITS[remainingUnitIndex].value
    }
  }
}

function orchestrateFreshRemainingSave({ repository, draft = {}, notify = () => {} }) {
  const raw = String(draft.remainingAmount ?? '').trim()
  const amount = raw === '' ? null : Number(raw)
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    const message = amount < 0 ? '余量不能小于 0' : '请填写有效余量'
    return { saved: false, message }
  }
  const remainingUnit = UNITS.some(({ value }) => value === draft.remainingUnit) ? draft.remainingUnit : ''
  if (amount !== null && !remainingUnit) return { saved: false, message: '请选择余量单位' }
  return settleOperation(() => repository && repository.updateMaterialInventory(draft.materialId, {
      remainingAmount: amount,
      remainingUnit: amount === null ? null : remainingUnit
    }), (saved) => {
    if (!saved) throw new Error('not saved')
    notify('余量已更新')
    return { saved: true, message: '' }
  }, () => {
    const message = '余量保存失败，请重试'
    notify(message)
    return { saved: false, message }
  })
}

function orchestrateFreshUseUp({ repository, materialId, notify = () => {} }) {
  return settleOperation(() => repository && repository.useUpFreshMaterial(materialId), (result) => {
    if (!result || !result.removed) throw new Error('Not removed')
    notify('已从手头鲜材移出')
    return { removed: true, materialId, undoToken: result.undoToken }
  }, () => {
    notify('操作失败，请重试')
    return { removed: false, materialId: '', undoToken: '' }
  })
}

function orchestrateFreshUndo({ repository, undo, notify = () => {} }) {
  return settleOperation(() => undo && repository && repository.restoreFreshMaterial(undo.materialId, undo.undoToken), (restored) => {
    if (!restored) throw new Error('Not restored')
    notify('已撤销')
    return { restored: true }
  }, () => {
    notify('无法撤销，材料可能已更新')
    return { restored: false }
  })
}

module.exports = {
  MATERIAL_LIBRARY_TABS,
  MATERIAL_LIBRARY_TEMPLATES,
  buildMaterialLibrary,
  buildGlasswareCards,
  buildFreshFormState,
  buildFreshRemainingEditorState,
  ensureLibraryMaterial,
  prepareGlasswareForSave,
  formatInventory,
  formatExpiry,
  getLocalDateOrdinal,
  orchestrateFreshRemainingSave,
  orchestrateFreshUseUp,
  orchestrateFreshUndo
}
