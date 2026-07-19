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
    id: typeof source.id === 'string' ? source.id : '',
    name: typeof source.name === 'string' ? source.name : '',
    ingredients: Array.isArray(source.ingredients) ? clone(source.ingredients) : [],
    preparations: Array.isArray(source.preparations) ? clone(source.preparations) : [],
    instructions: typeof source.instructions === 'string' ? source.instructions : '',
    rating: source.rating || null,
    glasswareId: typeof source.glasswareId === 'string' ? source.glasswareId : null,
    toolIds: Array.isArray(source.toolIds) ? source.toolIds.filter((id) => typeof id === 'string') : [],
    createdAt,
    updatedAt: validDate(source.updatedAt) ? source.updatedAt : createdAt
  }
}

function normalizeMaterial(material) {
  const source = material && typeof material === 'object' && !Array.isArray(material) ? material : {}
  let defaults
  try {
    defaults = createMaterialDefaults(source.category || 'other-liquid', typeof source.name === 'string' ? source.name : '')
  } catch (_) {
    defaults = createMaterialDefaults('other-liquid', typeof source.name === 'string' ? source.name : '')
  }

  const normalized = { ...defaults, ...clone(source) }
  normalized.id = typeof source.id === 'string' ? source.id : ''
  normalized.name = typeof source.name === 'string' ? source.name : ''
  normalized.freshOnHand = source.freshOnHand === true
  normalized.freshAddedAt = validDate(source.freshAddedAt) ? source.freshAddedAt : null
  normalized.freshExpiresAt = validDate(source.freshExpiresAt) ? source.freshExpiresAt : null
  return normalized
}

function normalizeNamedItem(item) {
  const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {}
  return { id: typeof source.id === 'string' ? source.id : '', name: typeof source.name === 'string' ? source.name : '' }
}

function normalizeTools(tools) {
  const supplied = Array.isArray(tools) ? tools : []
  const custom = supplied
    .filter((tool) => tool && typeof tool === 'object' && tool.builtIn !== true && typeof tool.id === 'string')
    .map((tool) => ({ id: tool.id, name: typeof tool.name === 'string' ? tool.name : '', builtIn: false }))
  const ids = new Set(builtInTools().map(({ id }) => id))
  return [...builtInTools(), ...custom.filter((tool) => !ids.has(tool.id))]
}

function migrateState(raw, now = new Date().toISOString()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return createInitialState()
  return {
    version: CURRENT_SCHEMA_VERSION,
    recipes: Array.isArray(raw.recipes) ? raw.recipes.map((recipe) => normalizeRecipe(recipe, now)) : [],
    materials: Array.isArray(raw.materials) ? raw.materials.map(normalizeMaterial) : [],
    glassware: Array.isArray(raw.glassware) ? raw.glassware.map(normalizeNamedItem) : [],
    tools: normalizeTools(raw.tools)
  }
}

module.exports = { CURRENT_SCHEMA_VERSION, STORAGE_KEY, createInitialState, migrateState }
