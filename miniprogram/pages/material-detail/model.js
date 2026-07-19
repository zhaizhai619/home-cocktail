const { getMaterialVisualState } = require('../../domain/material')
const { getMaterialUsageStats, getRecipesUsingMaterial, getMaterialPreferenceNotes, hydrateRecipeSummary } = require('../../domain/relations')
const { getPrimaryPreparation } = require('../../domain/recipe')
const { formatInventory, formatExpiry } = require('../materials/model')

function lookup(items) {
  return (Array.isArray(items) ? items : []).reduce((result, item) => {
    if (item && item.id) result[item.id] = item
    return result
  }, {})
}

function decodeMaterialId(value) {
  if (typeof value !== 'string' || !value) return ''
  try { return decodeURIComponent(value) } catch (_) { return '' }
}

function formatAmount(ingredient) {
  if (!ingredient) return ''
  if (ingredient.unit === 'top-up') return '补满'
  const labels = { piece: '个', slice: '片', drop: '滴', chunk: '块', 'to-taste': '适量' }
  const amount = ingredient.amount === null || ingredient.amount === undefined ? '' : ingredient.amount
  return `${amount}${labels[ingredient.unit] || ingredient.unit || ''}`
}

function formatPrep(preparations) {
  const prep = getPrimaryPreparation(preparations)
  if (!prep) return ''
  if (prep.type === '即调') return '即调'
  const unit = ['day', 'days', '天'].includes(prep.unit) ? '天' : '小时'
  return `${prep.type} · 提前${prep.amount}${unit}`
}

function buildRelatedRecipe(recipe, lookups) {
  const hydrated = hydrateRecipeSummary(recipe, lookups)
  const glasswareLabel = hydrated.glassware
    ? [hydrated.glassware.name, Number.isFinite(Number(hydrated.glassware.capacity || hydrated.glassware.capacityMl)) ? `${Number(hydrated.glassware.capacity || hydrated.glassware.capacityMl)}ml` : ''].filter(Boolean).join(' · ')
    : (recipe.glasswareId ? `杯具资料缺失（${recipe.glasswareId}）` : '未选杯具')
  const toolIds = Array.isArray(recipe.toolIds) ? recipe.toolIds : []
  const toolLabels = toolIds.map((id) => {
    const tool = lookups.toolsById[id]
    return tool ? (tool.name || '未命名用具') : `用具资料缺失（${id}）`
  })
  return {
    id: hydrated.id || '',
    name: hydrated.name || '未命名酒款',
    imagePath: recipe.imagePath || hydrated.image || '',
    preparationLabel: formatPrep(hydrated.preparations),
    ingredients: hydrated.ingredients.map((ingredient) => {
      const material = ingredient.material
      return {
        materialId: ingredient.materialId || '',
        name: material && material.name || '材料资料缺失',
        amountLabel: formatAmount(ingredient),
        state: material ? getMaterialVisualState(material) : 'missing-long-term'
      }
    }),
    glasswareLabel,
    toolsLabel: toolLabels.length ? toolLabels.join('、') : '无需特别用具'
  }
}

function buildMaterialDetail(material, sources = {}) {
  if (!material || typeof material !== 'object' || !material.id) return { status: 'missing', message: '没有找到这个材料，它可能已被删除' }
  const materials = Array.isArray(sources.materials) ? sources.materials : []
  const recipes = Array.isArray(sources.recipes) ? sources.recipes : []
  const materialsById = lookup(materials)
  const stats = getMaterialUsageStats(material.id, recipes, materialsById)
  const lookups = { materialsById, glasswareById: lookup(sources.glassware), toolsById: lookup(sources.tools) }
  return {
    status: 'ok',
    ...material,
    visualState: getMaterialVisualState(material),
    inventoryLabel: formatInventory(material),
    expiryLabel: formatExpiry(material.expiresAt, sources.now),
    usageCount: stats.usageCount,
    immediateUnlockCount: stats.immediateUnlockCount,
    canToggleOwned: material.acquisition === 'long-term',
    canAddFresh: material.acquisition === 'on-demand' && material.freshOnHand !== true,
    canUseUp: material.acquisition === 'on-demand' && material.freshOnHand === true,
    relatedRecipes: getRecipesUsingMaterial(material.id, recipes).map((recipe) => buildRelatedRecipe(recipe, lookups)),
    observations: getMaterialPreferenceNotes(material.id, recipes)
  }
}

module.exports = { buildMaterialDetail, decodeMaterialId }
