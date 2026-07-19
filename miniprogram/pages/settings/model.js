const { MAX_GLASS_CAPACITY_ML, normalizeEquipmentName } = require('../../domain/equipment-invariants')

function validateGlasswareForm(input) {
  const source = input && typeof input === 'object' ? input : {}
  const name = normalizeEquipmentName(source.name)
  const capacityMl = Number(source.capacityMl)
  if (!name) return { valid: false, message: '请填写杯具名称' }
  if (source.capacityMl === '' || source.capacityMl === null || source.capacityMl === undefined || !Number.isFinite(capacityMl) || capacityMl <= 0 || capacityMl > MAX_GLASS_CAPACITY_ML) return { valid: false, message: '杯具容量需大于 0 且不超过 5000ml' }
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
    ...item, usageCount: usageCount(recipes, (recipe) => recipe.glasswareId === item.id)
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
  try {
    const item = repository && repository[method](validation.value)
    if (!item) throw new Error('not saved')
    notify('已保存')
    return { saved: true, item }
  } catch (error) {
    notify(error && /已存在/.test(error.message) ? error.message : '保存失败，请重试')
    return { saved: false, item: null }
  }
}

function orchestrateGlasswareSave(options = {}) {
  return orchestrateSave({ ...options, validate: validateGlasswareForm, method: 'upsertGlassware' })
}

async function cleanupManagedImage(mediaFiles, path, message, warn) {
  if (!path || !mediaFiles || typeof mediaFiles.removeManagedFile !== 'function') return
  try { await mediaFiles.removeManagedFile(path) } catch (_) { warn(message) }
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
    const item = repository && repository.upsertGlassware({ ...validation.value, imagePath: persisted.path })
    if (!item) throw new Error('not saved')
    if (priorPath && priorPath !== persisted.path) await cleanupManagedImage(mediaFiles, priorPath, '杯具已保存，但旧图片清理失败', warn)
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
  if (usageCount > 0) {
    notify(`有 ${usageCount} 款酒正在使用，暂不能删除`)
    return { deleted: false, needsConfirmation: false, usageCount }
  }
  if (!confirmed) return { deleted: false, needsConfirmation: true, usageCount: 0 }
  try {
    const deleted = repository && repository[deleteMethod](id)
    if (!deleted) throw new Error('not deleted')
    notify('已删除')
    return { deleted: true, needsConfirmation: false, usageCount: 0 }
  } catch (_) {
    notify('删除失败，请重试')
    return { deleted: false, needsConfirmation: false, usageCount: 0 }
  }
}

async function orchestrateGlasswareMediaDelete({ repository, mediaFiles, id, confirmed = false, notify = () => {}, warn = () => {} } = {}) {
  const existing = repository && repository.getGlassware ? repository.getGlassware(id) : null
  const result = orchestrateEquipmentDelete({ repository, type: 'glassware', id, confirmed, notify })
  if (result.deleted && existing && existing.imagePath) await cleanupManagedImage(mediaFiles, existing.imagePath, '杯具已删除，但图片清理失败', warn)
  return result
}

module.exports = { MAX_GLASS_CAPACITY_ML, buildSettingsView, validateGlasswareForm, validateToolForm, orchestrateGlasswareSave, orchestrateGlasswareMediaSave, orchestrateToolSave, orchestrateEquipmentDelete, orchestrateGlasswareMediaDelete }
