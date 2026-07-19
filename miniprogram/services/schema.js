const { QUICK_TOOLS } = require('../domain/constants')
const { createMaterialDefaults } = require('../domain/material')

const CURRENT_SCHEMA_VERSION = 1
const STORAGE_KEY = 'home-cocktail-state'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function builtInTools() {
  return QUICK_TOOLS.map((name, index) => ({
    id: `quick-tool-${index + 1}`,
    name,
    builtIn: true
  }))
}

function createInitialState() {
  return {
    version: CURRENT_SCHEMA_VERSION,
    recipes: [],
    materials: [],
    glassware: [],
    tools: builtInTools()
  }
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime())
}

function normalizeRecipe(recipe, now) {
  const source = recipe && typeof recipe === 'object' && !Array.isArray(recipe) ? recipe : {}
  const createdAt = validDate(source.createdAt) ? source.createdAt : now
  return {
    ...clone(source),
    id: typeof source.id === 'string' ? source.id : '',
    name: typeof source.name === 'string' ? source.name : '',
    imagePath: typeof source.imagePath === 'string' ? source.imagePath : '',
    source: typeof source.source === 'string' ? source.source : '',
    tried: source.tried === true,
    ingredients: Array.isArray(source.ingredients) ? clone(source.ingredients) : [],
    preparations: Array.isArray(source.preparations) ? clone(source.preparations) : [],
    glasswareId: typeof source.glasswareId === 'string' ? source.glasswareId : null,
    toolIds: Array.isArray(source.toolIds) ? source.toolIds.filter((id) => typeof id === 'string') : [],
    steps: Array.isArray(source.steps) ? clone(source.steps) : (typeof source.instructions === 'string' && source.instructions ? [source.instructions] : []),
    rating: source.rating || null,
    tastingNote: typeof source.tastingNote === 'string' ? source.tastingNote : '',
    materialObservations: Array.isArray(source.materialObservations) ? clone(source.materialObservations) : [],
    createdAt,
    updatedAt: validDate(source.updatedAt) ? source.updatedAt : createdAt
  }
}

function normalizeMaterial(material, now) {
  const source = material && typeof material === 'object' && !Array.isArray(material) ? material : {}
  const { freshAddedAt, freshExpiresAt, ...userData } = source
  let defaults
  try {
    defaults = createMaterialDefaults(source.category || 'other-liquid', typeof source.name === 'string' ? source.name : '')
  } catch (_) {
    defaults = createMaterialDefaults('other-liquid', typeof source.name === 'string' ? source.name : '')
  }

  const createdAt = validDate(source.createdAt) ? source.createdAt : now
  const normalized = { ...defaults, ...clone(userData) }
  normalized.category = defaults.category
  normalized.alcoholic = source.alcoholic === undefined ? defaults.alcoholic : source.alcoholic === true
  normalized.trackFreshness = source.trackFreshness === undefined ? defaults.trackFreshness : source.trackFreshness === true
  normalized.assumedAvailable = source.assumedAvailable === undefined ? defaults.assumedAvailable : source.assumedAvailable === true
  normalized.owned = source.owned === undefined ? defaults.owned : source.owned === true
  normalized.id = typeof source.id === 'string' ? source.id : ''
  normalized.name = typeof source.name === 'string' ? source.name : ''
  normalized.freshOnHand = source.freshOnHand === true
  normalized.remainingAmount = Number.isFinite(source.remainingAmount) ? source.remainingAmount : null
  normalized.remainingUnit = typeof source.remainingUnit === 'string' ? source.remainingUnit : null
  normalized.purchasedAt = validDate(source.purchasedAt) ? source.purchasedAt : (validDate(freshAddedAt) ? freshAddedAt : null)
  normalized.expiresAt = validDate(source.expiresAt) ? source.expiresAt : (validDate(freshExpiresAt) ? freshExpiresAt : null)
  normalized.preferenceNote = typeof source.preferenceNote === 'string' ? source.preferenceNote : ''
  normalized.createdAt = createdAt
  normalized.updatedAt = validDate(source.updatedAt) ? source.updatedAt : createdAt
  if (normalized.acquisition === 'long-term') {
    normalized.freshOnHand = false
    if (normalized.assumedAvailable === true && normalized.trackFreshness === false) normalized.owned = true
  } else {
    normalized.owned = false
    normalized.assumedAvailable = false
  }
  if (!normalized.freshOnHand || normalized.trackFreshness !== true) {
    normalized.remainingAmount = null
    normalized.remainingUnit = null
    normalized.purchasedAt = null
    normalized.expiresAt = null
  }
  return normalized
}

function normalizeNamedItem(item) {
  const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {}
  return { ...clone(source), id: typeof source.id === 'string' ? source.id : '', name: typeof source.name === 'string' ? source.name : '' }
}

function repairIds(items, prefix, reservedIds = new Set()) {
  const used = new Set(reservedIds)
  let repaired = 0
  return items.map((item) => {
    if (typeof item.id === 'string' && item.id && !used.has(item.id)) {
      used.add(item.id)
      return item
    }
    let id
    do { id = `legacy-${prefix}-${++repaired}` } while (used.has(id))
    used.add(id)
    return { ...item, id }
  })
}

function normalizeTools(tools) {
  const supplied = Array.isArray(tools) ? tools : []
  const custom = supplied
    .filter((tool) => tool && typeof tool === 'object' && tool.builtIn !== true)
    .map((tool) => ({ ...clone(tool), id: typeof tool.id === 'string' ? tool.id : '', name: typeof tool.name === 'string' ? tool.name : '', builtIn: false }))
  const ids = new Set(builtInTools().map(({ id }) => id))
  return [...builtInTools(), ...repairIds(custom, 'tool', ids)]
}

function migrateState(raw, now = new Date().toISOString()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return createInitialState()
  return {
    version: CURRENT_SCHEMA_VERSION,
    recipes: repairIds(Array.isArray(raw.recipes) ? raw.recipes.map((recipe) => normalizeRecipe(recipe, now)) : [], 'recipe'),
    materials: repairIds(Array.isArray(raw.materials) ? raw.materials.map((material) => normalizeMaterial(material, now)) : [], 'material'),
    glassware: repairIds(Array.isArray(raw.glassware) ? raw.glassware.map(normalizeNamedItem) : [], 'glassware'),
    tools: normalizeTools(raw.tools)
  }
}

module.exports = { CURRENT_SCHEMA_VERSION, STORAGE_KEY, createInitialState, migrateState }
