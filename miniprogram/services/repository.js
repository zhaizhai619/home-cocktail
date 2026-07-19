const { createMaterialDefaults } = require('../domain/material')
const { STORAGE_KEY, migrateState } = require('./schema')

function clone(value) { return JSON.parse(JSON.stringify(value)) }

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
    const source = { ...(existing || {}), ...(value || {}) }
    let defaults
    try { defaults = createMaterialDefaults(source.category || 'other-liquid', source.name || '') } catch (_) { defaults = createMaterialDefaults('other-liquid', source.name || '') }
    const timestamp = now()
    return migrateState({ materials: [{ ...defaults, ...source, id: source.id || idFactory(), freshOnHand: source.freshOnHand === true, createdAt: existing ? existing.createdAt : timestamp, updatedAt: timestamp }] }, timestamp).materials[0]
  }
  function remove(key, id, predicate = () => true) {
    const data = current(); const index = data[key].findIndex((entry) => entry.id === id && predicate(entry))
    if (index === -1) return false
    data[key].splice(index, 1); save(); return true
  }
  return {
    initialize, getState: () => clone(current()),
    listRecipes: () => list('recipes'), getRecipe: (id) => get('recipes', id), upsertRecipe: (value) => upsert('recipes', value, recipe), deleteRecipe: (id) => remove('recipes', id),
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
