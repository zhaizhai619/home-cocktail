const { MATERIAL_CATEGORY_GROUPS, getMaterialCategoryGroup, getMaterialIdentityKey, getMaterialVisualState, materialNameMatchesQuery } = require('../../domain/material')
const { UNITS } = require('../../domain/constants')
const { getMaterialUsageStats } = require('../../domain/relations')
const { formatGlasswareLabel } = require('../../domain/equipment')
const { normalizeEquipmentName } = require('../../domain/equipment-invariants')
const { isValidDateString } = require('../../domain/date')

const MATERIAL_LIBRARY_TABS = Object.freeze([
  { key: 'all', label: '全部' },
  ...MATERIAL_CATEGORY_GROUPS.map(({ key, label }) => ({ key, label }))
])

const MATERIAL_LIBRARY_TEMPLATES = Object.freeze([
  { name: '金酒', category: 'base-spirit' },
  { name: '白朗姆', category: 'base-spirit' },
  { name: '伏特加', category: 'base-spirit' },
  { name: '椰子利口酒', category: 'liqueur' },
  { name: '普通糖浆', category: 'syrup/staple' },
  { name: '接骨木糖浆', category: 'syrup/staple' }
])

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
  if (!material || material.freshOnHand !== true) return ''
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
  const expiryLabel = material.freshOnHand === true && material.trackFreshness === true ? formatExpiry(material.expiresAt, now, undefined) : ''
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
    isFreshShelf: material.acquisition === 'on-demand' && material.freshOnHand === true
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
  const freshShelf = cards.filter((card) => card.isFreshShelf)
  const libraryCards = options.includeCatalog === true ? mergeCatalogTemplates(cards) : cards
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
  return { freshShelf: freshShelf.sort(byRecent), materials: filtered.sort(byLibraryPriority) }
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

function orchestrateFreshUseUp({ repository, materialId, notify = () => {} }) {
  try {
    const result = repository && repository.useUpFreshMaterial(materialId)
    if (!result || !result.removed) throw new Error('Not removed')
    notify('已从手头鲜材移出')
    return { removed: true, materialId, undoToken: result.undoToken }
  } catch (_) {
    notify('操作失败，请重试')
    return { removed: false, materialId: '', undoToken: '' }
  }
}

function orchestrateFreshUndo({ repository, undo, notify = () => {} }) {
  try {
    const restored = undo && repository && repository.restoreFreshMaterial(undo.materialId, undo.undoToken)
    if (!restored) throw new Error('Not restored')
    notify('已撤销')
    return { restored: true }
  } catch (_) {
    notify('无法撤销，材料可能已更新')
    return { restored: false }
  }
}

module.exports = {
  MATERIAL_LIBRARY_TABS,
  MATERIAL_LIBRARY_TEMPLATES,
  buildMaterialLibrary,
  buildGlasswareCards,
  buildFreshFormState,
  ensureLibraryMaterial,
  prepareGlasswareForSave,
  formatInventory,
  formatExpiry,
  getLocalDateOrdinal,
  orchestrateFreshUseUp,
  orchestrateFreshUndo
}
