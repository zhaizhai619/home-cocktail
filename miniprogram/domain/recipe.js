const { PREP_TYPES, RATINGS } = require('./constants')
const { getMaterialVisualState } = require('./material')

const INSTANT_PREPARATION = '即调'
const DAY_UNITS = new Set(['day', 'days', '天'])

function normalizePrepSelections(preparations) {
  if (!Array.isArray(preparations)) {
    return []
  }

  const uniquePreparations = []
  const seenTypes = new Set()

  for (const preparation of preparations) {
    if (!preparation || seenTypes.has(preparation.type)) {
      continue
    }

    seenTypes.add(preparation.type)
    uniquePreparations.push({ ...preparation })
  }

  const hasAdvancePreparation = uniquePreparations.some(
    ({ type }) => type !== INSTANT_PREPARATION
  )

  return hasAdvancePreparation
    ? uniquePreparations.filter(({ type }) => type !== INSTANT_PREPARATION)
    : uniquePreparations
}

function getLeadHours(preparation) {
  if (preparation.type === INSTANT_PREPARATION) {
    return 0
  }

  const amount = Number(preparation.amount)
  const safeAmount = Number.isFinite(amount) ? amount : 0
  return DAY_UNITS.has(preparation.unit) ? safeAmount * 24 : safeAmount
}

function getPrimaryPreparation(preparations) {
  const normalized = normalizePrepSelections(preparations)

  if (normalized.length === 0) {
    return null
  }

  let primary = normalized[0]
  let primaryLeadHours = getLeadHours(primary)

  for (const preparation of normalized.slice(1)) {
    const leadHours = getLeadHours(preparation)
    const preparationOrder = PREP_TYPES.indexOf(preparation.type)
    const primaryOrder = PREP_TYPES.indexOf(primary.type)

    if (
      leadHours > primaryLeadHours ||
      (leadHours === primaryLeadHours && preparationOrder < primaryOrder)
    ) {
      primary = preparation
      primaryLeadHours = leadHours
    }
  }

  return { ...primary, leadHours: primaryLeadHours }
}

function getMaterialReadiness(recipe, materialsById) {
  let needsFreshMaterial = false
  const materialLookup = materialsById || {}
  const ingredients = Array.isArray(recipe && recipe.ingredients)
    ? recipe.ingredients
    : []

  for (const ingredient of ingredients) {
    const material = materialLookup[ingredient && ingredient.materialId]

    if (!material) {
      return 'missing-long-term'
    }

    const state = getMaterialVisualState(material)

    if (state === 'missing-long-term') {
      return 'missing-long-term'
    }

    if (state === 'quick-buy') {
      needsFreshMaterial = true
    }
  }

  return needsFreshMaterial ? 'fresh-only' : 'on-hand'
}

function filterRecipes(recipes, options = {}, materialsById = {}) {
  const prepType = options.prepType || 'all'
  const materialCondition = options.materialCondition || 'all'

  return (Array.isArray(recipes) ? recipes : []).filter((recipe) => {
    const preparations = Array.isArray(recipe.preparations)
      ? recipe.preparations
      : []
    const matchesPreparation = prepType === 'all' || preparations.some(
      ({ type }) => type === prepType
    )
    const matchesMaterials = materialCondition === 'all' ||
      getMaterialReadiness(recipe, materialsById) === materialCondition

    return matchesPreparation && matchesMaterials
  })
}

function getCreatedAt(recipe) {
  const timestamp = new Date(recipe.createdAt).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function compareRecent(first, second) {
  return getCreatedAt(second) - getCreatedAt(first)
}

function getPreparationLeadHours(recipe) {
  const primary = getPrimaryPreparation(recipe.preparations)
  return primary ? primary.leadHours : 0
}

function compareRecipes(first, second, sortKey) {
  if (sortKey === 'prep-time') {
    return getPreparationLeadHours(first) - getPreparationLeadHours(second) ||
      compareRecent(first, second)
  }

  if (sortKey === 'recent') {
    return compareRecent(first, second)
  }

  if (sortKey === 'rating') {
    const firstRating = RATINGS.indexOf(first.rating)
    const secondRating = RATINGS.indexOf(second.rating)
    const firstRank = firstRating === -1 ? RATINGS.length : firstRating
    const secondRank = secondRating === -1 ? RATINGS.length : secondRating

    return firstRank - secondRank || compareRecent(first, second)
  }

  if (sortKey === 'name') {
    return String(first.name || '').localeCompare(String(second.name || ''))
  }

  return 0
}

function sortRecipes(recipes, sortKey) {
  return (Array.isArray(recipes) ? recipes : [])
    .map((recipe, index) => ({ recipe, index }))
    .sort((first, second) => (
      compareRecipes(first.recipe, second.recipe, sortKey) ||
      first.index - second.index
    ))
    .map(({ recipe }) => recipe)
}

module.exports = {
  normalizePrepSelections,
  getPrimaryPreparation,
  getMaterialReadiness,
  filterRecipes,
  sortRecipes
}
