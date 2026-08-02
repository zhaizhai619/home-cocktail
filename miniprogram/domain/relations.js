function getIngredients(recipe) {
  const serving = (Array.isArray(recipe && recipe.ingredients) ? recipe.ingredients : [])
    .filter((ingredient) => !(ingredient && ingredient.kind === 'prepared-output'))
  const advance = (Array.isArray(recipe && recipe.advancePreparations) ? recipe.advancePreparations : [])
    .flatMap((preparation) => Array.isArray(preparation && preparation.ingredients) ? preparation.ingredients : [])
  return [...serving, ...advance]
}

function getRecipesUsingMaterial(materialId, recipes) {
  if (typeof materialId !== 'string') {
    return []
  }

  return (Array.isArray(recipes) ? recipes : []).filter((recipe) => (
    getIngredients(recipe).some((ingredient) => (
      ingredient && typeof ingredient === 'object' &&
      ingredient.materialId === materialId
    ))
  ))
}

function isImmediateUnlockTarget(material) {
  return material && getMaterialVisualState(material) === 'missing-long-term'
}

function recipeIsAvailableAfterBuying(recipe, targetId, materialsById) {
  for (const ingredient of getIngredients(recipe)) {
    if (!ingredient || typeof ingredient !== 'object' ||
      typeof ingredient.materialId !== 'string') {
      return false
    }

    if (ingredient.materialId === targetId) {
      continue
    }

    const material = materialsById[ingredient.materialId]
    if (!material) {
      return false
    }

    if (getMaterialVisualState(material) === 'missing-long-term') {
      return false
    }
  }

  return true
}

function getMaterialUsageStats(materialId, recipes, materialsById) {
  const usingRecipes = getRecipesUsingMaterial(materialId, recipes)
  const lookup = materialsById && typeof materialsById === 'object'
    ? materialsById
    : {}
  const target = lookup[materialId]

  return {
    usageCount: usingRecipes.length,
    immediateUnlockCount: isImmediateUnlockTarget(target)
      ? usingRecipes.filter((recipe) => (
        recipeIsAvailableAfterBuying(recipe, materialId, lookup)
      )).length
      : 0
  }
}

function hydrateRecipeSummary(recipe, lookups = {}) {
  const source = recipe && typeof recipe === 'object' ? recipe : {}
  const materialsById = lookups.materialsById && typeof lookups.materialsById === 'object'
    ? lookups.materialsById
    : {}
  const glasswareById = lookups.glasswareById && typeof lookups.glasswareById === 'object'
    ? lookups.glasswareById
    : {}
  const toolsById = lookups.toolsById && typeof lookups.toolsById === 'object'
    ? lookups.toolsById
    : {}
  const ingredients = getIngredients(source)
    .filter((ingredient) => ingredient && typeof ingredient === 'object')
    .map((ingredient) => ({
      ...ingredient,
      material: materialsById[ingredient.materialId] || null
    }))
  const toolIds = Array.isArray(source.toolIds) ? source.toolIds.slice() : []

  return {
    id: source.id,
    name: source.name,
    image: source.image,
    preparations: source.preparations,
    rating: source.rating,
    ingredients,
    glasswareId: source.glasswareId,
    glassware: glasswareById[source.glasswareId] || null,
    toolIds,
    tools: toolIds.map((toolId) => toolsById[toolId]).filter(Boolean)
  }
}

function getMaterialPreferenceNotes(materialId, recipes, directObservations) {
  const notes = []

  ;(Array.isArray(directObservations) ? directObservations : []).forEach((observation, observationIndex) => {
    if (!observation || typeof observation !== 'object' ||
      typeof observation.note !== 'string' || !observation.note.trim()) return
    const timestamp = typeof observation.createdAt === 'string' ? Date.parse(observation.createdAt) : NaN
    notes.push({
      recipeId: '', recipeName: '', note: observation.note.trim(), createdAt: observation.createdAt,
      observationIndex, direct: true, timestamp, order: notes.length
    })
  })

  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    if (!recipe || typeof recipe !== 'object' ||
      !Array.isArray(recipe.materialObservations)) {
      continue
    }

    recipe.materialObservations.forEach((observation, observationIndex) => {
      if (!observation || typeof observation !== 'object' ||
        observation.materialId !== materialId ||
        typeof observation.note !== 'string' || !observation.note.trim()) {
        return
      }

      const timestamp = typeof observation.createdAt === 'string'
        ? Date.parse(observation.createdAt)
        : NaN
      notes.push({
        recipeId: recipe.id,
        recipeName: recipe.name,
        note: observation.note,
        createdAt: observation.createdAt,
        observationIndex,
        timestamp,
        order: notes.length
      })
    })
  }

  return notes.sort((first, second) => {
    const firstValid = Number.isFinite(first.timestamp)
    const secondValid = Number.isFinite(second.timestamp)
    if (firstValid && secondValid) {
      return second.timestamp - first.timestamp || first.order - second.order
    }
    if (firstValid !== secondValid) {
      return firstValid ? -1 : 1
    }
    return first.order - second.order
  }).map(({ recipeId, recipeName, note, createdAt, observationIndex, direct }) => ({
    recipeId,
    recipeName,
    note,
    createdAt,
    observationIndex,
    ...(direct ? { direct: true } : {})
  }))
}

module.exports = {
  getRecipesUsingMaterial,
  getMaterialUsageStats,
  hydrateRecipeSummary,
  getMaterialPreferenceNotes
}
const { getMaterialVisualState } = require('./material')
