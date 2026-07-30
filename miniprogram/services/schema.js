const { QUICK_TOOLS, normalizePreparationType } = require('../domain/constants')
const { createMaterialDefaults, getMaterialIdentityKey, isMaterialAvailable, normalizeMaterialName, normalizeMaterialObservations } = require('../domain/material')
const { normalizeEquipmentName, normalizeGlassCapacity, equipmentNameIdentity, makeUniqueEquipmentName } = require('../domain/equipment-invariants')
const { isValidDateString } = require('../domain/date')

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
  return isValidDateString(value)
}

function normalizeAdvancePreparations(source) {
  const supplied = Array.isArray(source.advancePreparations)
    ? source.advancePreparations
    : (source.advancePreparation && typeof source.advancePreparation === 'object' && !Array.isArray(source.advancePreparation) ? [source.advancePreparation] : [])
  const usedIds = new Set()
  const advancePreparations = supplied.map((preparation, index) => {
    const item = preparation && typeof preparation === 'object' && !Array.isArray(preparation) ? preparation : {}
    let id = typeof item.id === 'string' && item.id && !usedIds.has(item.id) ? item.id : `advance-preparation-${index + 1}`
    let suffix = index + 1
    while (usedIds.has(id)) id = `advance-preparation-${++suffix}`
    usedIds.add(id)
    return {
      id,
      outputName: typeof item.outputName === 'string' ? item.outputName : '',
      ingredients: Array.isArray(item.ingredients) ? clone(item.ingredients) : [],
      steps: Array.isArray(item.steps) ? clone(item.steps) : (typeof item.steps === 'string' ? item.steps.split('\n').map((step) => step.trim()).filter(Boolean) : [])
    }
  })
  const ingredients = Array.isArray(source.ingredients) ? clone(source.ingredients) : []
  for (const preparation of advancePreparations) {
    if (!ingredients.some((ingredient) => ingredient && ingredient.kind === 'prepared-output' && ingredient.preparationId === preparation.id)) {
      const lastPreparedIndex = ingredients.reduce((last, ingredient, index) => ingredient && ingredient.kind === 'prepared-output' ? index : last, -1)
      ingredients.splice(lastPreparedIndex + 1, 0, { kind: 'prepared-output', preparationId: preparation.id, amount: null, unit: 'to-taste' })
    }
  }
  return { advancePreparations, ingredients }
}

function normalizeRecipe(recipe, now) {
  const source = recipe && typeof recipe === 'object' && !Array.isArray(recipe) ? recipe : {}
  const sourceWithoutLegacyAdvance = clone(source)
  delete sourceWithoutLegacyAdvance.advancePreparation
  delete sourceWithoutLegacyAdvance.advancePreparations
  delete sourceWithoutLegacyAdvance.ingredients
  const advance = normalizeAdvancePreparations(source)
  const createdAt = validDate(source.createdAt) ? source.createdAt : now
  return {
    ...clone(sourceWithoutLegacyAdvance),
    id: typeof source.id === 'string' ? source.id : '',
    name: typeof source.name === 'string' ? source.name : '',
    imagePath: typeof source.imagePath === 'string' ? source.imagePath : '',
    source: typeof source.source === 'string' ? source.source : '',
    tried: source.tried === true,
    ingredientOrderCustomized: source.ingredientOrderCustomized === true,
    ingredients: advance.ingredients,
    advancePreparations: advance.advancePreparations,
    preparations: Array.isArray(source.preparations) ? source.preparations.map((preparation) => (
      preparation && typeof preparation === 'object' && !Array.isArray(preparation)
        ? { ...clone(preparation), type: normalizePreparationType(preparation.type) }
        : clone(preparation)
    )) : [],
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
  normalized.acquisition = ['long-term', 'on-demand'].includes(source.acquisition) ? source.acquisition : defaults.acquisition
  normalized.alcoholic = source.alcoholic === undefined ? defaults.alcoholic : source.alcoholic === true
  normalized.trackFreshness = source.trackFreshness === undefined ? defaults.trackFreshness : source.trackFreshness === true
  normalized.assumedAvailable = source.assumedAvailable === undefined ? defaults.assumedAvailable : source.assumedAvailable === true
  normalized.owned = source.owned === undefined ? defaults.owned : source.owned === true
  normalized.id = typeof source.id === 'string' ? source.id : ''
  normalized.name = defaults.name
  normalized.freshOnHand = source.freshOnHand === true
  normalized.remainingAmount = Number.isFinite(source.remainingAmount) ? source.remainingAmount : null
  normalized.remainingUnit = typeof source.remainingUnit === 'string' ? source.remainingUnit : null
  normalized.purchasedAt = validDate(source.purchasedAt) ? source.purchasedAt : (validDate(freshAddedAt) ? freshAddedAt : null)
  normalized.expiresAt = validDate(source.expiresAt) ? source.expiresAt : (validDate(freshExpiresAt) ? freshExpiresAt : null)
  normalized.preferenceNote = typeof source.preferenceNote === 'string' ? source.preferenceNote : ''
  if (Array.isArray(source.observations)) normalized.observations = normalizeMaterialObservations(source.observations)
  else delete normalized.observations
  normalized.createdAt = createdAt
  normalized.updatedAt = validDate(source.updatedAt) ? source.updatedAt : createdAt
  if (normalized.acquisition === 'long-term') {
    normalized.freshOnHand = false
    if (normalized.assumedAvailable === true && normalized.trackFreshness === false) normalized.owned = true
  } else {
    normalized.owned = false
    normalized.assumedAvailable = false
  }
  const currentlyAvailable = isMaterialAvailable(normalized)
  if (!currentlyAvailable || normalized.trackFreshness !== true) {
    normalized.remainingAmount = null
    normalized.remainingUnit = null
    normalized.expiresAt = null
  }
  if (!currentlyAvailable) normalized.purchasedAt = null
  return normalized
}

function normalizeGlassware(item) {
  const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {}
  const { capacity, note, ...userData } = source
  const capacityMl = Number(source.capacityMl !== undefined ? source.capacityMl : capacity)
  return {
    ...clone(userData),
    id: typeof source.id === 'string' ? source.id : '',
    name: normalizeEquipmentName(source.name),
    capacityMl: normalizeGlassCapacity(capacityMl),
    imagePath: typeof source.imagePath === 'string' ? source.imagePath.trim() : '',
    notes: typeof source.notes === 'string' ? source.notes.trim() : (typeof note === 'string' ? note.trim() : '')
  }
}

function normalizeMaterialCollection(materials, now) {
  const sourceItems = Array.isArray(materials) ? materials : []
  const normalized = repairIds(sourceItems.map((material) => normalizeMaterial(material, now)), 'material')
  const indexesByIdentity = new Map()
  normalized.forEach((material, index) => {
    const identity = getMaterialIdentityKey(material.category, material.name)
    const indexes = indexesByIdentity.get(identity) || []
    indexes.push(index)
    indexesByIdentity.set(identity, indexes)
  })
  const originalNames = sourceItems.map((material) => String(material && material.name || '').trim())
  const removedIndexes = new Set()
  const remap = new Map()

  for (const indexes of indexesByIdentity.values()) {
    const aliasIndexes = indexes.filter((index) => {
      const originalName = originalNames[index]
      return originalName && normalizeMaterialName(normalized[index].category, originalName) !== originalName
    })
    if (aliasIndexes.length === 0) continue

    const canonicalIndexes = indexes.filter((index) => originalNames[index] === normalized[index].name)
    const survivorIndex = canonicalIndexes.length ? canonicalIndexes[0] : aliasIndexes[0]
    const survivorOriginalName = originalNames[survivorIndex]
    const aliasesToRemove = canonicalIndexes.length
      ? aliasIndexes
      : aliasIndexes.filter((index) => originalNames[index] !== survivorOriginalName)
    for (const index of aliasesToRemove) {
      removedIndexes.add(index)
      remap.set(normalized[index].id, normalized[survivorIndex].id)
    }
  }

  return {
    materials: normalized.filter((_, index) => !removedIndexes.has(index)),
    remap
  }
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

function normalizeGlasswareCollection(glassware) {
  const withIds = repairIds(Array.isArray(glassware) ? glassware.map(normalizeGlassware) : [], 'glassware')
  return withIds.map((item) => ({ ...item, name: item.name || '未命名酒杯' }))
}

function uniqueLegacyToolId(used, reserved) {
  let index = 1
  let id
  do { id = `legacy-tool-${index++}` } while (used.has(id) || reserved.has(id))
  return id
}

function normalizeTools(tools) {
  const supplied = Array.isArray(tools) ? tools : []
  const custom = supplied
    .filter((tool) => tool && typeof tool === 'object' && tool.builtIn !== true)
    .map((tool) => ({ ...clone(tool), id: typeof tool.id === 'string' ? tool.id : '', name: normalizeEquipmentName(tool.name), builtIn: false }))
  const fixed = builtInTools()
  const fixedIds = new Set(fixed.map(({ id }) => id))
  const reservedCustomIds = new Set(custom.map(({ id }) => id).filter((id) => id && !fixedIds.has(id)))
  const usedIds = new Set(fixedIds)
  const remap = new Map()
  const repaired = custom.map((tool) => {
    const oldId = tool.id
    let id = oldId
    if (!id || usedIds.has(id)) {
      id = uniqueLegacyToolId(usedIds, reservedCustomIds)
      if (fixedIds.has(oldId) && !remap.has(oldId)) remap.set(oldId, id)
    }
    usedIds.add(id)
    return { ...tool, id }
  })
  const usedNames = new Set(fixed.map(({ name }) => equipmentNameIdentity(name)))
  const named = repaired.map((tool) => ({ ...tool, name: makeUniqueEquipmentName(tool.name, '未命名用具', usedNames) }))
  return { tools: [...fixed, ...named], remap }
}

function migrateState(raw, now = new Date().toISOString()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return createInitialState()
  const recipes = repairIds(Array.isArray(raw.recipes) ? raw.recipes.map((recipe) => normalizeRecipe(recipe, now)) : [], 'recipe')
  const normalizedMaterials = normalizeMaterialCollection(raw.materials, now)
  const normalizedTools = normalizeTools(raw.tools)
  for (const recipe of recipes) {
    const seen = new Set()
    recipe.toolIds = recipe.toolIds.map((id) => normalizedTools.remap.get(id) || id).filter((id) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    recipe.ingredients = recipe.ingredients.map((ingredient) => (
      ingredient && typeof ingredient === 'object' && ingredient.kind !== 'prepared-output'
        ? { ...ingredient, materialId: normalizedMaterials.remap.get(ingredient.materialId) || ingredient.materialId }
        : ingredient
    ))
    recipe.advancePreparations = recipe.advancePreparations.map((preparation) => ({
      ...preparation,
      ingredients: preparation.ingredients.map((ingredient) => (
        ingredient && typeof ingredient === 'object'
          ? { ...ingredient, materialId: normalizedMaterials.remap.get(ingredient.materialId) || ingredient.materialId }
          : ingredient
      ))
    }))
    recipe.materialObservations = recipe.materialObservations.map((observation) => (
      observation && typeof observation === 'object'
        ? { ...observation, materialId: normalizedMaterials.remap.get(observation.materialId) || observation.materialId }
        : observation
    ))
  }
  return {
    version: CURRENT_SCHEMA_VERSION,
    recipes,
    materials: normalizedMaterials.materials,
    glassware: normalizeGlasswareCollection(raw.glassware),
    tools: normalizedTools.tools
  }
}

module.exports = { CURRENT_SCHEMA_VERSION, STORAGE_KEY, createInitialState, migrateState }
