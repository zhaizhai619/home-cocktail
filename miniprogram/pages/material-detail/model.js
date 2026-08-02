const { getMaterialVisualState, isMaterialAvailable } = require('../../domain/material')
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
  const currentlyAvailable = isMaterialAvailable(material)
  const inventoryLabel = formatInventory(material)
  return {
    status: 'ok',
    ...material,
    visualState: getMaterialVisualState(material),
    inventoryLabel: inventoryLabel === '当前在手头' ? '' : inventoryLabel,
    expiryLabel: material.trackFreshness === true && currentlyAvailable ? formatExpiry(material.expiresAt, sources.now) : '',
    purchasedAtDate: formatDateInput(material.purchasedAt),
    canEditPurchasedAt: currentlyAvailable,
    usageCount: stats.usageCount,
    immediateUnlockCount: stats.immediateUnlockCount,
    available: currentlyAvailable,
    canToggleAvailable: true,
    canToggleTracking: currentlyAvailable,
    canEditTracking: currentlyAvailable && material.trackFreshness === true,
    observations: getMaterialPreferenceNotes(material.id, recipes, material.observations).map((item) => ({
      ...item,
      createdAtLabel: formatDateInput(item.createdAt),
      renderKey: item.direct
        ? `material:${material.id}:${item.observationIndex}`
        : `recipe:${item.recipeId}:${item.observationIndex}`
    }))
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

function orchestrateMaterialObservationUpdate({
  repository,
  materialId,
  recipeId,
  direct,
  observationIndex,
  note,
  notify = () => {}
} = {}) {
  const validation = validateMaterialObservation(note)
  if (!validation.valid) {
    notify(validation.message)
    return { saved: false, message: validation.message }
  }
  try {
    const saved = direct
      ? repository && repository.updateMaterialObservation(materialId, observationIndex, { note: validation.note })
      : repository && repository.updateRecipeObservation(recipeId, observationIndex, { note: validation.note })
    if (!saved) throw new Error('Observation not updated')
    notify('记录已更新')
    return { saved: true, message: '' }
  } catch (_) {
    const message = '保存失败，请重试'
    notify(message)
    return { saved: false, message }
  }
}

function orchestrateMaterialObservationDelete({
  repository,
  materialId,
  recipeId,
  direct,
  observationIndex,
  notify = () => {}
} = {}) {
  try {
    const saved = direct
      ? repository && repository.deleteMaterialObservation(materialId, observationIndex)
      : repository && repository.deleteRecipeObservation(recipeId, observationIndex)
    if (!saved) throw new Error('Observation not deleted')
    notify('记录已删除')
    return { deleted: true }
  } catch (_) {
    notify('删除失败，请重试')
    return { deleted: false }
  }
}

module.exports = {
  buildMaterialDetail,
  decodeMaterialId,
  validateMaterialObservation,
  orchestrateMaterialObservationSave,
  orchestrateMaterialObservationUpdate,
  orchestrateMaterialObservationDelete
}
