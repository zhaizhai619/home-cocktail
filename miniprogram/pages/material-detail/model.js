const { getMaterialVisualState } = require('../../domain/material')
const { getMaterialUsageStats, getMaterialPreferenceNotes } = require('../../domain/relations')
const { formatInventory, formatExpiry } = require('../materials/model')
const { toLocalDateValue } = require('../../domain/date')

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

function formatDateInput(value) {
  return toLocalDateValue(value)
}

function buildMaterialDetail(material, sources = {}) {
  if (!material || typeof material !== 'object' || !material.id) return { status: 'missing', message: '没有找到这个材料，它可能已被删除' }
  const materials = Array.isArray(sources.materials) ? sources.materials : []
  const recipes = Array.isArray(sources.recipes) ? sources.recipes : []
  const stats = getMaterialUsageStats(material.id, recipes, lookup(materials))
  const currentlyAvailable = material.acquisition === 'long-term' ? material.owned === true : material.freshOnHand === true
  return {
    status: 'ok',
    ...material,
    visualState: getMaterialVisualState(material),
    inventoryLabel: formatInventory(material),
    expiryLabel: material.trackFreshness === true && material.freshOnHand === true ? formatExpiry(material.expiresAt, sources.now) : '',
    purchasedAtDate: formatDateInput(material.purchasedAt),
    canEditPurchasedAt: currentlyAvailable,
    usageCount: stats.usageCount,
    immediateUnlockCount: stats.immediateUnlockCount,
    canToggleOwned: material.acquisition === 'long-term',
    canAddFresh: material.acquisition === 'on-demand' && material.freshOnHand !== true,
    canUseUp: material.acquisition === 'on-demand' && material.freshOnHand === true,
    observations: getMaterialPreferenceNotes(material.id, recipes, material.observations)
  }
}

function validateMaterialObservation(note) {
  const normalizedNote = String(note || '').trim()
  return normalizedNote ? { valid: true, note: normalizedNote } : { valid: false, message: '请填写材料观察' }
}

function orchestrateMaterialObservationSave({ repository, materialId, note, notify = () => {} } = {}) {
  const validation = validateMaterialObservation(note)
  if (!validation.valid) {
    notify(validation.message)
    return { saved: false, material: null, message: validation.message }
  }
  try {
    const material = repository && repository.appendMaterialObservation(materialId, { note: validation.note })
    if (!material) throw new Error('not saved')
    notify('观察已保存')
    return { saved: true, material, message: '' }
  } catch (_) {
    const message = '保存失败，请重试'
    notify(message)
    return { saved: false, material: null, message }
  }
}

module.exports = { buildMaterialDetail, decodeMaterialId, validateMaterialObservation, orchestrateMaterialObservationSave }
