const { getMaterialVisualState } = require('../../domain/material')
const { getMaterialUsageStats } = require('../../domain/relations')

function asLookup(items) {
  return (Array.isArray(items) ? items : []).reduce((lookup, item) => {
    if (item && typeof item.id === 'string' && item.id) lookup[item.id] = item
    return lookup
  }, {})
}

function formatInventory(material) {
  if (!material || material.freshOnHand !== true) return ''
  if (material.trackFreshness !== true) return '当前在手头'
  if (Number.isFinite(Number(material.remainingAmount))) {
    const labels = { piece: '个', slice: '片', drop: '滴', chunk: '块', 'top-up': '补满', 'to-taste': '适量' }
    return `还剩约 ${Number(material.remainingAmount)}${labels[material.remainingUnit] || material.remainingUnit || ''}`
  }
  return '当前在手头'
}

function formatExpiry(value, nowValue) {
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  const now = Number.isFinite(Date.parse(nowValue)) ? new Date(nowValue) : new Date()
  const expiry = new Date(value)
  const day = 24 * 60 * 60 * 1000
  const days = Math.ceil((expiry.getTime() - now.getTime()) / day)
  if (days < 0) return `已过期 ${Math.abs(days)} 天`
  if (days === 0) return '今天到期'
  return `${days} 天后到期`
}

function buildCard(material, recipes, materialsById, now) {
  const stats = getMaterialUsageStats(material.id, recipes, materialsById)
  const visualState = getMaterialVisualState(material)
  const inventoryLabel = formatInventory(material)
  const expiryLabel = material.trackFreshness === true ? formatExpiry(material.expiresAt, now) : ''
  return {
    ...material,
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
  const filtered = cards.filter((card) => {
    if (query && !String(card.name || '').toLocaleLowerCase().includes(query)) return false
    if (acquisition !== 'all' && card.acquisition !== acquisition) return false
    return matchesFilter(card, options.filter || 'all')
  })
  const byRecent = (first, second) => String(second.updatedAt || '').localeCompare(String(first.updatedAt || '')) || String(first.name || '').localeCompare(String(second.name || ''), 'zh-CN')
  return { freshShelf: freshShelf.sort(byRecent), materials: filtered.sort(byRecent) }
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
  buildMaterialLibrary,
  formatInventory,
  formatExpiry,
  orchestrateFreshUseUp,
  orchestrateFreshUndo
}
