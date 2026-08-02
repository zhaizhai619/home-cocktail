const { MAX_GLASS_CAPACITY_ML, normalizeEquipmentName, isValidGlassCapacity } = require('../../domain/equipment-invariants')
const { settleOperation } = require('../../services/maybe-promise')

function createEditorOperationGuard() {
  let currentToken = null
  let sequence = 0
  return {
    begin() {
      if (currentToken) return null
      currentToken = { id: ++sequence }
      return currentToken
    },
    isCurrent(token) { return Boolean(token && token === currentToken) },
    canMutateEditor() { return currentToken === null },
    finish(token) {
      if (token !== currentToken) return false
      currentToken = null
      return true
    }
  }
}

function validateGlasswareForm(input) {
  const source = input && typeof input === 'object' ? input : {}
  const name = normalizeEquipmentName(source.name)
  const capacityMl = Number(source.capacityMl)
  if (!name) return { valid: false, message: '请填写酒杯名称' }
  if (source.capacityMl === '' || source.capacityMl === null || source.capacityMl === undefined || !Number.isFinite(capacityMl) || capacityMl <= 0 || capacityMl > MAX_GLASS_CAPACITY_ML) return { valid: false, message: '酒杯容量需大于 0 且不超过 5000ml' }
  return { valid: true, value: { ...(source.id ? { id: source.id } : {}), name, capacityMl, imagePath: String(source.imagePath || '').trim(), notes: String(source.notes || '').trim() } }
}

function validateToolForm(input) {
  const source = input && typeof input === 'object' ? input : {}
  const name = normalizeEquipmentName(source.name)
  if (!name) return { valid: false, message: '请填写用具名称' }
  return { valid: true, value: { ...(source.id ? { id: source.id } : {}), name } }
}

function usageCount(recipes, predicate) {
  return (Array.isArray(recipes) ? recipes : []).filter((recipe) => recipe && predicate(recipe)).length
}

function buildSettingsView(glassware = [], tools = [], recipes = []) {
  const glasswareItems = (Array.isArray(glassware) ? glassware : []).map((item) => ({
    ...item,
    capacityLabel: isValidGlassCapacity(item.capacityMl) ? `${Number(item.capacityMl)}ml` : '容量待补充',
    usageCount: usageCount(recipes, (recipe) => recipe.glasswareId === item.id)
  }))
  const toolItems = (Array.isArray(tools) ? tools : []).map((item) => ({
    ...item, usageCount: usageCount(recipes, (recipe) => Array.isArray(recipe.toolIds) && recipe.toolIds.includes(item.id))
  }))
  return {
    glassware: glasswareItems,
    builtInTools: toolItems.filter((item) => item.builtIn === true),
    customTools: toolItems.filter((item) => item.builtIn !== true)
  }
}

function orchestrateSave({ repository, form, validate, method, notify = () => {} }) {
  const validation = validate(form)
  if (!validation.valid) { notify(validation.message); return { saved: false, item: null } }
  return settleOperation(() => repository && repository[method](validation.value), (item) => {
    if (!item) throw new Error('not saved')
    notify('已保存')
    return { saved: true, item }
  }, (error) => {
    notify(error && /已存在/.test(error.message) ? error.message : '保存失败，请重试')
    return { saved: false, item: null }
  })
}

function orchestrateGlasswareSave(options = {}) {
  return orchestrateSave({ ...options, validate: validateGlasswareForm, method: 'upsertGlassware' })
}

async function cleanupManagedImage(mediaFiles, path, message, warn) {
  if (!path || !mediaFiles || typeof mediaFiles.removeManagedFile !== 'function') return
  try { await mediaFiles.removeManagedFile(path) } catch (_) { warn(message) }
}

async function cleanupIfUnreferenced({ repository, mediaFiles, path, message, warn = () => {} } = {}) {
  if (!path || !mediaFiles || typeof mediaFiles.removeManagedFile !== 'function') return { removed: false }
  if (typeof mediaFiles.isManagedPath === 'function' && !mediaFiles.isManagedPath(path)) return { removed: false }
  try {
    if (!repository || typeof repository.listGlassware !== 'function') throw new Error('Glassware lookup unavailable')
    const glasses = repository.listGlassware()
    if (glasses.some((item) => item && item.imagePath === path)) return { removed: false }
    return await mediaFiles.removeManagedFile(path)
  } catch (_) {
    warn(message)
    return { removed: false, failed: true }
  }
}

async function orchestrateGlasswareMediaSave({ repository, mediaFiles, form, selectedImagePath, notify = () => {}, warn = () => {} } = {}) {
  const validation = validateGlasswareForm(form)
  if (!validation.valid) { notify(validation.message); return { saved: false, item: null } }
  const existing = validation.value.id && repository && repository.getGlassware ? repository.getGlassware(validation.value.id) : null
  const priorPath = existing && existing.imagePath || ''
  const desiredPath = selectedImagePath === undefined ? validation.value.imagePath : String(selectedImagePath || '').trim()
  let persisted = { path: desiredPath, created: false }
  try {
    if (desiredPath) {
      if (!mediaFiles || typeof mediaFiles.persistGlasswareImage !== 'function') throw new Error('Media service unavailable')
      persisted = await mediaFiles.persistGlasswareImage(desiredPath)
    }
  } catch (_) {
    notify('图片保存失败，请重试')
    return { saved: false, item: null }
  }
  try {
    const item = await repository.upsertGlassware({ ...validation.value, imagePath: persisted.path })
    if (!item) throw new Error('not saved')
    if (priorPath && priorPath !== persisted.path) await cleanupIfUnreferenced({ repository, mediaFiles, path: priorPath, message: '酒杯已保存，但旧图片清理失败', warn })
    notify('已保存')
    return { saved: true, item }
  } catch (error) {
    if (persisted.created) await cleanupManagedImage(mediaFiles, persisted.path, '保存失败，且新图片清理失败', warn)
    notify(error && /已存在/.test(error.message) ? error.message : '保存失败，请重试')
    return { saved: false, item: null }
  }
}

function orchestrateToolSave(options = {}) {
  return orchestrateSave({ ...options, validate: validateToolForm, method: 'upsertTool' })
}

function orchestrateEquipmentDelete({ repository, type, id, confirmed = false, notify = () => {} } = {}) {
  const isGlassware = type === 'glassware'
  const usageMethod = isGlassware ? 'getGlasswareUsageCount' : 'getToolUsageCount'
  const deleteMethod = isGlassware ? 'deleteGlassware' : 'deleteTool'
  const usageCount = repository && typeof repository[usageMethod] === 'function' ? repository[usageMethod](id) : 0
  if (!isGlassware && usageCount > 0) {
    notify(`有 ${usageCount} 款酒正在使用，暂不能删除`)
    return { deleted: false, needsConfirmation: false, usageCount }
  }
  if (!confirmed) return { deleted: false, needsConfirmation: true, usageCount }
  return settleOperation(() => repository && repository[deleteMethod](id), (deleted) => {
    if (!deleted) throw new Error('not deleted')
    notify('已删除')
    return { deleted: true, needsConfirmation: false, usageCount }
  }, () => {
    notify('删除失败，请重试')
    return { deleted: false, needsConfirmation: false, usageCount }
  })
}

async function orchestrateGlasswareMediaDelete({ repository, mediaFiles, id, confirmed = false, notify = () => {}, warn = () => {} } = {}) {
  const existing = repository && repository.getGlassware ? repository.getGlassware(id) : null
  const result = await orchestrateEquipmentDelete({ repository, type: 'glassware', id, confirmed, notify })
  if (result.deleted && existing && existing.imagePath) await cleanupIfUnreferenced({ repository, mediaFiles, path: existing.imagePath, message: '酒杯已删除，但图片清理失败', warn })
  return result
}

module.exports = { MAX_GLASS_CAPACITY_ML, createEditorOperationGuard, buildSettingsView, validateGlasswareForm, validateToolForm, cleanupIfUnreferenced, orchestrateGlasswareSave, orchestrateGlasswareMediaSave, orchestrateToolSave, orchestrateEquipmentDelete, orchestrateGlasswareMediaDelete }
