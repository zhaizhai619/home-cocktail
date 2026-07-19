const { createMaterialDefaults, getMaterialIdentityKey } = require('../domain/material')
const { UNITS } = require('../domain/constants')
const { STORAGE_KEY, migrateState } = require('./schema')

const MAX_UNIQUE_ID_ATTEMPTS = 20
const MATERIAL_CATEGORIES = new Set(['base-spirit', 'other-base-spirit', 'liqueur', 'bitters', 'citrus', 'syrup/staple', 'fruit', 'dairy/juice', 'soda/tonic', 'other-liquid', 'other-solid'])
const CATEGORY_ALIASES = { tonic: 'soda/tonic', soda: 'soda/tonic', dairy: 'dairy/juice', juice: 'dairy/juice', syrup: 'syrup/staple', staple: 'syrup/staple' }
const ACQUISITIONS = new Set(['long-term', 'on-demand'])
const FORMS = new Set(['liquid', 'solid'])
const UNIT_VALUES = new Set(UNITS.map(({ value }) => value))
const MAX_GLASS_CAPACITY_ML = 5000

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function hasSuppliedAbv(value) { return value !== null && value !== undefined && String(value).trim() !== '' }
function hasValidAbv(value) { const abv = Number(value); return Number.isFinite(abv) && abv > 0 && abv <= 100 }
function isValidOptionalDate(value) { return value === null || value === undefined || value === '' || (typeof value === 'string' && Number.isFinite(Date.parse(value))) }

function validateMaterialValue(value, existing) {
  const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const source = { ...(existing || {}), ...incoming }
  for (const field of ['alcoholic', 'trackFreshness', 'assumedAvailable', 'owned', 'freshOnHand']) {
    if (Object.prototype.hasOwnProperty.call(incoming, field) && typeof incoming[field] !== 'boolean') throw new RangeError(`Invalid material ${field}`)
  }
  const category = CATEGORY_ALIASES[source.category] || source.category
  if (!String(source.name || '').trim()) throw new RangeError('Invalid material name')
  if (!MATERIAL_CATEGORIES.has(category)) throw new RangeError('Invalid material category')
  const defaults = createMaterialDefaults(category, String(source.name).trim())
  const normalized = { ...defaults, ...source, category, name: String(source.name).trim() }
  if (!ACQUISITIONS.has(normalized.acquisition)) throw new RangeError('Invalid material acquisition')
  if (!FORMS.has(normalized.form)) throw new RangeError('Invalid material form')
  if (!UNIT_VALUES.has(normalized.defaultUnit)) throw new RangeError('Invalid material unit')
  if (normalized.alcoholic === true && hasSuppliedAbv(normalized.abv) && !hasValidAbv(normalized.abv)) throw new RangeError('Invalid material ABV')
  if (normalized.alcoholic !== true) normalized.abv = null
  if (normalized.freshOnHand === true && normalized.trackFreshness === true) {
    if (hasSuppliedAbv(normalized.remainingAmount)) {
      const amount = Number(normalized.remainingAmount)
      if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Invalid material remaining amount')
      normalized.remainingAmount = amount
    } else normalized.remainingAmount = null
    if (normalized.remainingUnit !== null && normalized.remainingUnit !== undefined && normalized.remainingUnit !== '' && !UNIT_VALUES.has(normalized.remainingUnit)) throw new RangeError('Invalid material remaining unit')
    normalized.remainingUnit = normalized.remainingUnit || null
    if (!isValidOptionalDate(normalized.purchasedAt) || !isValidOptionalDate(normalized.expiresAt)) throw new RangeError('Invalid material date')
  } else {
    normalized.remainingAmount = null
    normalized.remainingUnit = null
    normalized.purchasedAt = null
    normalized.expiresAt = null
  }
  normalized.alcoholic = normalized.alcoholic === true
  normalized.trackFreshness = normalized.trackFreshness === true
  normalized.assumedAvailable = normalized.trackFreshness ? false : normalized.assumedAvailable === true
  normalized.owned = normalized.owned === true
  normalized.freshOnHand = normalized.freshOnHand === true
  if ((normalized.acquisition === 'long-term' && normalized.freshOnHand) || (normalized.acquisition === 'on-demand' && normalized.owned)) throw new RangeError('Invalid material availability')
  if (normalized.acquisition === 'on-demand') normalized.assumedAvailable = false
  if (normalized.acquisition === 'long-term' && normalized.owned === false) normalized.assumedAvailable = false
  return normalized
}

function createWxStorageAdapter(wxApi) {
  return {
    get(key) { return wxApi.getStorageSync(key) },
    set(key, value) { wxApi.setStorageSync(key, value) }
  }
}

function createRepository(adapter, options = {}) {
  const idFactory = options.idFactory || (() => `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const now = options.now || (() => new Date().toISOString())
  let state = null

  function initialize() {
    const raw = adapter.get(STORAGE_KEY)
    state = migrateState(raw, raw ? now() : undefined)
    adapter.set(STORAGE_KEY, clone(state))
    return clone(state)
  }
  function current() { return state || initialize() }
  function save() { adapter.set(STORAGE_KEY, clone(state)) }
  function list(key) { return clone(current()[key]) }
  function get(key, id) { const item = current()[key].find((entry) => entry.id === id); return item ? clone(item) : null }
  function atomicStateUpdate(mutator) {
    const nextState = clone(current())
    const outcome = mutator(nextState)
    if (!outcome || outcome.changed !== true) return outcome ? outcome.value : null
    adapter.set(STORAGE_KEY, clone(nextState))
    state = nextState
    return outcome.value && typeof outcome.value === 'object' ? clone(outcome.value) : outcome.value
  }
  function createUniqueMaterialId(materials) {
    const existingIds = new Set(materials.map(({ id }) => id))
    for (let attempt = 0; attempt < MAX_UNIQUE_ID_ATTEMPTS; attempt++) {
      const candidate = idFactory()
      if (typeof candidate === 'string' && candidate && !existingIds.has(candidate)) return candidate
    }
    throw new Error('Unable to generate unique material ID')
  }
  function createUniqueRecipeId(recipes) {
    const existingIds = new Set(recipes.map(({ id }) => id))
    for (let attempt = 0; attempt < MAX_UNIQUE_ID_ATTEMPTS; attempt++) {
      const candidate = idFactory()
      if (typeof candidate === 'string' && candidate && !existingIds.has(candidate)) return candidate
    }
    throw new Error('Unable to generate unique recipe ID')
  }
  function createUniqueEquipmentId(items) {
    const existingIds = new Set(items.map(({ id }) => id))
    for (let attempt = 0; attempt < MAX_UNIQUE_ID_ATTEMPTS; attempt++) {
      const candidate = idFactory()
      if (typeof candidate === 'string' && candidate && !existingIds.has(candidate)) return candidate
    }
    throw new Error('Unable to generate unique equipment ID')
  }
  function upsert(key, value, normalize) {
    const data = current(); const incoming = value && typeof value === 'object' ? value : {}
    const index = incoming.id ? data[key].findIndex((entry) => entry.id === incoming.id) : -1
    const saved = normalize(incoming, index === -1 ? null : data[key][index])
    if (index === -1) data[key].push(saved); else data[key][index] = saved
    save(); return clone(saved)
  }
  function equipmentName(value) { return String(value || '').trim().replace(/\s+/g, ' ') }
  function equipmentIdentity(value) { return equipmentName(value).toLocaleLowerCase('zh-CN') }
  function saveGlassware(value) {
    return atomicStateUpdate((nextState) => {
      const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const index = incoming.id ? nextState.glassware.findIndex((item) => item.id === incoming.id) : -1
      if (incoming.id && index === -1) throw new RangeError('杯具不存在')
      const existing = index === -1 ? null : nextState.glassware[index]
      const source = { ...(existing || {}), ...incoming }
      const name = equipmentName(source.name)
      const capacityMl = Number(source.capacityMl)
      if (!name) throw new RangeError('请填写杯具名称')
      if (source.capacityMl === '' || source.capacityMl === null || source.capacityMl === undefined || !Number.isFinite(capacityMl) || capacityMl <= 0 || capacityMl > MAX_GLASS_CAPACITY_ML) throw new RangeError('杯具容量需大于 0 且不超过 5000ml')
      if (nextState.glassware.some((item, itemIndex) => itemIndex !== index && equipmentIdentity(item.name) === equipmentIdentity(name))) throw new Error('同名杯具已存在')
      const saved = {
        id: existing ? existing.id : createUniqueEquipmentId(nextState.glassware),
        name,
        capacityMl,
        imagePath: String(source.imagePath || '').trim(),
        notes: String(source.notes !== undefined ? source.notes : source.note || '').trim()
      }
      if (index === -1) nextState.glassware.push(saved); else nextState.glassware[index] = saved
      return { changed: true, value: saved }
    })
  }
  function saveTool(value) {
    return atomicStateUpdate((nextState) => {
      const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const index = incoming.id ? nextState.tools.findIndex((item) => item.id === incoming.id) : -1
      if (incoming.id && index === -1) throw new RangeError('用具不存在')
      const existing = index === -1 ? null : nextState.tools[index]
      if (existing && existing.builtIn === true) throw new RangeError('固定用具不可编辑')
      const name = equipmentName(incoming.name !== undefined ? incoming.name : existing && existing.name)
      if (!name) throw new RangeError('请填写用具名称')
      if (nextState.tools.some((item, itemIndex) => itemIndex !== index && equipmentIdentity(item.name) === equipmentIdentity(name))) throw new Error('同名用具已存在')
      const saved = { id: existing ? existing.id : createUniqueEquipmentId(nextState.tools), name, builtIn: false }
      if (index === -1) nextState.tools.push(saved); else nextState.tools[index] = saved
      return { changed: true, value: saved }
    })
  }
  function recipe(value, existing) {
    const timestamp = now()
    const source = { ...(existing || {}), ...(value || {}) }
    return migrateState({ recipes: [{ ...source, id: source.id || idFactory(), createdAt: existing ? existing.createdAt : timestamp, updatedAt: timestamp }] }, timestamp).recipes[0]
  }
  function material(value, existing, preserveExplicitDefaults = false) {
    const incoming = value && typeof value === 'object' ? value : {}
    const source = { ...(existing || {}), ...incoming }
    let defaults
    try { defaults = createMaterialDefaults(source.category || 'other-liquid', source.name || '') } catch (_) { defaults = createMaterialDefaults('other-liquid', source.name || '') }
    const timestamp = now()
    const derivedFields = ['acquisition', 'form', 'defaultUnit', 'alcoholic', 'abv', 'owned', 'freshOnHand', 'trackFreshness', 'assumedAvailable']
    const categoryChanged = existing && defaults.category !== existing.category
    const normalizedSource = { ...defaults, ...source, category: defaults.category }
    if (categoryChanged) {
      for (const field of derivedFields) {
        if (!Object.prototype.hasOwnProperty.call(incoming, field) || (!preserveExplicitDefaults && incoming[field] === existing[field])) {
          normalizedSource[field] = defaults[field]
        }
      }
    }
    return migrateState({ materials: [{ ...normalizedSource, id: source.id || idFactory(), freshOnHand: normalizedSource.freshOnHand === true, createdAt: existing ? existing.createdAt : timestamp, updatedAt: timestamp }] }, timestamp).materials[0]
  }
  function materialKey(value) {
    const source = value && typeof value === 'object' ? value : {}
    return getMaterialIdentityKey(source.category, source.name)
  }
  function saveMaterial(value, saveOptions = {}) {
    return atomicStateUpdate((nextState) => {
      const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const index = incoming.id ? nextState.materials.findIndex((entry) => entry.id === incoming.id) : -1
      if (incoming.id && index === -1) throw new RangeError('Invalid material ID')
      const existing = index === -1 ? null : nextState.materials[index]
      const validated = validateMaterialValue(incoming, existing)
      const identity = getMaterialIdentityKey(validated.category, validated.name)
      if (nextState.materials.some((entry, entryIndex) => entryIndex !== index && getMaterialIdentityKey(entry.category, entry.name) === identity)) throw new Error('Material already exists')
      const normalizedForSave = { ...validated }
      if (existing && validated.category !== existing.category) {
        const categoryDefaults = createMaterialDefaults(validated.category, validated.name)
        for (const field of ['acquisition', 'form', 'defaultUnit', 'alcoholic', 'abv', 'owned', 'freshOnHand', 'trackFreshness', 'assumedAvailable']) {
          if (!Object.prototype.hasOwnProperty.call(incoming, field)) normalizedForSave[field] = categoryDefaults[field]
        }
      }
      const saved = material({ ...normalizedForSave, id: existing ? existing.id : createUniqueMaterialId(nextState.materials), freshUndoToken: null, freshUndoSnapshot: null }, existing, saveOptions.preserveExplicitDefaults !== false)
      if (index === -1) nextState.materials.push(saved); else nextState.materials[index] = saved
      return { changed: true, value: saved }
    })
  }
  function saveRecipeWithMaterials(recipeValue, materialDrafts = [], materialUpdates = []) {
    current()
    const originalState = state
    state = clone(originalState)
    try {
      for (const draft of Array.isArray(materialDrafts) ? materialDrafts : []) {
        if (draft && draft.alcoholic === true && hasSuppliedAbv(draft.abv) && !hasValidAbv(draft.abv)) throw new RangeError('Invalid ABV draft')
      }
      const updatesById = new Map()
      for (const update of Array.isArray(materialUpdates) ? materialUpdates : []) {
        if (update && typeof update.id === 'string') updatesById.set(update.id, update)
      }
      for (const [id, update] of updatesById) {
        const index = state.materials.findIndex((item) => item.id === id)
        const abv = Number(update.abv)
        if (index === -1 || !state.materials[index].alcoholic || !hasValidAbv(abv)) throw new RangeError('Invalid ABV update')
        state.materials[index] = material({ ...state.materials[index], abv }, state.materials[index])
      }
      const idsByDraftKey = {}
      const idsByMaterialKey = {}
      for (const existingMaterial of state.materials) {
        const key = materialKey(existingMaterial)
        if (!idsByMaterialKey[key]) idsByMaterialKey[key] = existingMaterial.id
      }
      for (const draft of Array.isArray(materialDrafts) ? materialDrafts : []) {
        if (!draft || typeof draft !== 'object') continue
        const key = materialKey(draft)
        let id = idsByMaterialKey[key]
        if (!id) {
          const { draftKey, ...materialValue } = draft
          const savedMaterial = material(materialValue, null)
          state.materials.push(savedMaterial)
          id = savedMaterial.id
          idsByMaterialKey[key] = id
        }
        if (typeof draft.draftKey === 'string' && draft.draftKey) idsByDraftKey[draft.draftKey] = id
        idsByDraftKey[key] = id
      }
      const inputRecipe = recipeValue && typeof recipeValue === 'object' ? recipeValue : {}
      const resolveId = (item) => item && (item.materialId || idsByDraftKey[item.draftKey] || '')
      const resolvedRecipe = {
        ...inputRecipe,
        ingredients: (Array.isArray(inputRecipe.ingredients) ? inputRecipe.ingredients : []).map((item) => ({ materialId: resolveId(item), amount: item.amount, unit: item.unit })),
        materialObservations: (Array.isArray(inputRecipe.materialObservations) ? inputRecipe.materialObservations : []).map((item) => ({ materialId: resolveId(item), note: item.note, ...(typeof item.createdAt === 'string' && item.createdAt ? { createdAt: item.createdAt } : {}) })).filter((item) => item.materialId)
      }
      const index = resolvedRecipe.id ? state.recipes.findIndex((item) => item.id === resolvedRecipe.id) : -1
      const savedRecipe = recipe(resolvedRecipe, index === -1 ? null : state.recipes[index])
      if (index === -1) state.recipes.push(savedRecipe); else state.recipes[index] = savedRecipe
      adapter.set(STORAGE_KEY, clone(state))
      return clone(savedRecipe)
    } catch (error) {
      state = originalState
      throw error
    }
  }
  return {
    initialize, getState: () => clone(current()),
    listRecipes: () => list('recipes'), getRecipe: (id) => get('recipes', id), upsertRecipe: (value) => upsert('recipes', value, recipe), saveRecipeWithMaterials,
    appendRecipeObservation(id, value) {
      const materialId = value && value.materialId
      const note = String(value && value.note || '').trim()
      return atomicStateUpdate((nextState) => {
        const index = nextState.recipes.findIndex((item) => item.id === id)
        const existing = index === -1 ? null : nextState.recipes[index]
        const ingredients = Array.isArray(existing && existing.ingredients) ? existing.ingredients : []
        const belongsToRecipe = ingredients.some((ingredient) => ingredient && ingredient.materialId === materialId)
        if (!belongsToRecipe || !note) return { changed: false, value: null }
        const savedRecipe = recipe({
          ...existing,
          materialObservations: [...existing.materialObservations, { materialId, note, createdAt: now() }]
        }, existing)
        nextState.recipes[index] = savedRecipe
        return { changed: true, value: savedRecipe }
      })
    },
    duplicateRecipe(id) {
      return atomicStateUpdate((nextState) => {
        const existing = nextState.recipes.find((item) => item.id === id)
        if (!existing) return { changed: false, value: null }
        const { id: ignoredId, createdAt: ignoredCreatedAt, updatedAt: ignoredUpdatedAt, ...copy } = existing
        const savedRecipe = recipe({ ...copy, id: createUniqueRecipeId(nextState.recipes), name: `${copy.name || ''}副本` }, null)
        nextState.recipes.push(savedRecipe)
        return { changed: true, value: savedRecipe }
      })
    },
    deleteRecipe: (id) => atomicStateUpdate((nextState) => {
      const index = nextState.recipes.findIndex((item) => item.id === id)
      if (index === -1) return { changed: false, value: false }
      nextState.recipes.splice(index, 1)
      return { changed: true, value: true }
    }),
    listMaterials: () => list('materials'), getMaterial: (id) => get('materials', id), saveMaterial,
    upsertMaterial(value) {
      const source = value && typeof value === 'object' ? { ...value } : {}
      if (!MATERIAL_CATEGORIES.has(CATEGORY_ALIASES[source.category] || source.category)) source.category = 'other-liquid'
      return saveMaterial(source, { preserveExplicitDefaults: false })
    },
    setMaterialOwned(id, owned) {
      const item = get('materials', id)
      if (!item) return null
      if (item.acquisition !== 'long-term') throw new RangeError('Invalid material availability')
      return saveMaterial({ ...item, owned: owned === true, assumedAvailable: false })
    },
    addToFreshShelf(id, fields = {}) {
      const item = get('materials', id)
      if (!item) return null
      if (item.acquisition !== 'on-demand') throw new RangeError('Invalid material availability')
      return saveMaterial({
        ...item, ...fields, freshOnHand: true,
        purchasedAt: item.trackFreshness ? (fields.purchasedAt || item.purchasedAt || now()) : null,
        expiresAt: item.trackFreshness ? (fields.expiresAt || item.expiresAt || null) : null,
        freshUndoToken: null
      })
    },
    updateFreshShelf(id, fields = {}) {
      const item = get('materials', id)
      if (!item) return null
      if (item.acquisition !== 'on-demand') throw new RangeError('Invalid material availability')
      return saveMaterial({ ...item, ...fields, freshOnHand: true, freshUndoToken: null })
    },
    useUpFreshMaterial(id) {
      return atomicStateUpdate((nextState) => {
        const index = nextState.materials.findIndex((entry) => entry.id === id)
        const existing = index === -1 ? null : nextState.materials[index]
        if (!existing || existing.freshOnHand !== true) return { changed: false, value: { removed: false, undoToken: '' } }
        const undoToken = createUniqueMaterialId(nextState.materials)
        const saved = material({ ...existing, freshOnHand: false, remainingAmount: null, remainingUnit: null, purchasedAt: null, expiresAt: null, freshUndoToken: undoToken, freshUndoSnapshot: clone(existing) }, existing)
        nextState.materials[index] = saved
        return { changed: true, value: { removed: true, undoToken } }
      })
    },
    restoreFreshMaterial(id, undoToken) {
      return atomicStateUpdate((nextState) => {
        const index = nextState.materials.findIndex((entry) => entry.id === id)
        const existing = index === -1 ? null : nextState.materials[index]
        if (!existing || !undoToken || existing.freshOnHand === true || existing.freshUndoToken !== undoToken || !existing.freshUndoSnapshot) return { changed: false, value: null }
        const snapshot = existing.freshUndoSnapshot
        const saved = material({ ...snapshot, id: existing.id, freshUndoToken: null, freshUndoSnapshot: null }, existing)
        nextState.materials[index] = saved
        return { changed: true, value: saved }
      })
    },
    removeFromFreshShelf(id) { return this.useUpFreshMaterial(id).removed },
    getMaterialUsageCount(id) {
      return current().recipes.filter((recipe) => Array.isArray(recipe.ingredients) && recipe.ingredients.some((ingredient) => ingredient && ingredient.materialId === id)).length
    },
    deleteMaterial(id) {
      return atomicStateUpdate((nextState) => {
        const index = nextState.materials.findIndex((entry) => entry.id === id)
        if (index === -1) return { changed: false, value: { deleted: false, reason: 'not-found', usageCount: 0 } }
        const usageCount = nextState.recipes.filter((recipe) => Array.isArray(recipe.ingredients) && recipe.ingredients.some((ingredient) => ingredient && ingredient.materialId === id)).length
        if (usageCount) return { changed: false, value: { deleted: false, reason: 'referenced', usageCount } }
        nextState.materials.splice(index, 1)
        return { changed: true, value: { deleted: true, reason: '', usageCount: 0 } }
      })
    },
    listGlassware: () => list('glassware'), getGlassware: (id) => get('glassware', id), upsertGlassware: saveGlassware,
    getGlasswareUsageCount(id) { return current().recipes.filter((item) => item && item.glasswareId === id).length },
    deleteGlassware(id) {
      return atomicStateUpdate((nextState) => {
        const index = nextState.glassware.findIndex((item) => item.id === id)
        if (index === -1) return { changed: false, value: false }
        if (nextState.recipes.some((item) => item && item.glasswareId === id)) return { changed: false, value: false }
        nextState.glassware.splice(index, 1)
        return { changed: true, value: true }
      })
    },
    listTools: () => list('tools'), getTool: (id) => get('tools', id), upsertTool: saveTool,
    getToolUsageCount(id) { return current().recipes.filter((item) => item && Array.isArray(item.toolIds) && item.toolIds.includes(id)).length },
    deleteTool(id) {
      return atomicStateUpdate((nextState) => {
        const index = nextState.tools.findIndex((item) => item.id === id)
        if (index === -1 || nextState.tools[index].builtIn === true) return { changed: false, value: false }
        if (nextState.recipes.some((item) => item && Array.isArray(item.toolIds) && item.toolIds.includes(id))) return { changed: false, value: false }
        nextState.tools.splice(index, 1)
        return { changed: true, value: true }
      })
    }
  }
}

module.exports = { createRepository, createWxStorageAdapter }
