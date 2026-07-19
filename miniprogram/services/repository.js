const { createMaterialDefaults, getMaterialIdentityKey } = require('../domain/material')
const { STORAGE_KEY, migrateState } = require('./schema')

const MAX_UNIQUE_ID_ATTEMPTS = 20

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function hasSuppliedAbv(value) { return value !== null && value !== undefined && String(value).trim() !== '' }
function hasValidAbv(value) { const abv = Number(value); return Number.isFinite(abv) && abv > 0 && abv <= 100 }

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
  function createUniqueRecipeId(recipes) {
    const existingIds = new Set(recipes.map(({ id }) => id))
    for (let attempt = 0; attempt < MAX_UNIQUE_ID_ATTEMPTS; attempt++) {
      const candidate = idFactory()
      if (typeof candidate === 'string' && candidate && !existingIds.has(candidate)) return candidate
    }
    throw new Error('Unable to generate unique recipe ID')
  }
  function upsert(key, value, normalize) {
    const data = current(); const incoming = value && typeof value === 'object' ? value : {}
    const index = incoming.id ? data[key].findIndex((entry) => entry.id === incoming.id) : -1
    const saved = normalize(incoming, index === -1 ? null : data[key][index])
    if (index === -1) data[key].push(saved); else data[key][index] = saved
    save(); return clone(saved)
  }
  function named(value, existing) {
    return { ...(existing || {}), ...(value || {}), id: value && value.id || existing && existing.id || idFactory(), name: typeof (value && value.name) === 'string' ? value.name : (existing ? existing.name : '') }
  }
  function recipe(value, existing) {
    const timestamp = now()
    const source = { ...(existing || {}), ...(value || {}) }
    return migrateState({ recipes: [{ ...source, id: source.id || idFactory(), createdAt: existing ? existing.createdAt : timestamp, updatedAt: timestamp }] }, timestamp).recipes[0]
  }
  function material(value, existing) {
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
        if (!Object.prototype.hasOwnProperty.call(incoming, field) || incoming[field] === existing[field]) {
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
  function remove(key, id, predicate = () => true) {
    const data = current(); const index = data[key].findIndex((entry) => entry.id === id && predicate(entry))
    if (index === -1) return false
    data[key].splice(index, 1); save(); return true
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
    listMaterials: () => list('materials'), getMaterial: (id) => get('materials', id), upsertMaterial: (value) => upsert('materials', value, material),
    setMaterialOwned(id, owned) { const item = get('materials', id); return item ? this.upsertMaterial({ ...item, owned: owned === true }) : null },
    addToFreshShelf(id, fields = {}) { const item = get('materials', id); return item ? this.upsertMaterial({ ...item, ...fields, freshOnHand: true, purchasedAt: fields.purchasedAt || item.purchasedAt || now(), expiresAt: fields.expiresAt || item.expiresAt || null }) : null },
    updateFreshShelf(id, fields = {}) { const item = get('materials', id); return item ? this.upsertMaterial({ ...item, ...fields, freshOnHand: true }) : null },
    removeFromFreshShelf(id) { const item = get('materials', id); if (!item) return false; this.upsertMaterial({ ...item, freshOnHand: false, remainingAmount: null, remainingUnit: null, purchasedAt: null, expiresAt: null }); return true },
    listGlassware: () => list('glassware'), getGlassware: (id) => get('glassware', id), upsertGlassware: (value) => upsert('glassware', value, named), deleteGlassware: (id) => remove('glassware', id),
    listTools: () => list('tools'), getTool: (id) => get('tools', id), upsertTool(value) { const existing = value && value.id ? get('tools', value.id) : null; if (existing && existing.builtIn) return false; return upsert('tools', value, (item, prior) => ({ ...named(item, prior), builtIn: false })) }, deleteTool: (id) => remove('tools', id, (tool) => tool.builtIn !== true)
  }
}

module.exports = { createRepository, createWxStorageAdapter }
