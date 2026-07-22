const { PREP_TYPES, RATINGS, normalizePreparationType } = require('./constants')
const { getMaterialVisualState } = require('./material')

const INSTANT_PREPARATION = '即调'
const DAY_UNITS = new Set(['day', 'days', '天'])
const PREPARATION_UNITS = new Set([
  'hour',
  'hours',
  '小时',
  ...DAY_UNITS
])

function getPreparationDurationText(preparation) {
  if (!preparation || typeof preparation !== 'object' || preparation.type === INSTANT_PREPARATION) return ''
  if (typeof preparation.durationText === 'string') return preparation.durationText.trim()
  const amount = Number(preparation.amount)
  if (!Number.isFinite(amount) || amount <= 0 || !PREPARATION_UNITS.has(preparation.unit)) return ''
  const amountEnd = Number(preparation.amountEnd)
  const range = preparation.amountEnd !== undefined && preparation.amountEnd !== null && preparation.amountEnd !== '' && Number.isFinite(amountEnd) && amountEnd >= amount
    ? `${amount}–${amountEnd}`
    : String(amount)
  return `${range}${DAY_UNITS.has(preparation.unit) ? '天' : '小时'}`
}

function getPreparationDurationParts(preparation) {
  const durationText = getPreparationDurationText(preparation)
  const match = durationText.match(/^(.*?)(小时|天)$/)
  if (!match) return { value: durationText, unit: 'hour' }
  return { value: match[1].trim(), unit: match[2] === '天' ? 'day' : 'hour' }
}

function formatPreparationDurationText(value, unit) {
  const normalized = String(value || '').trim().replace(/(?:小时|天)$/, '').trim()
  if (!normalized) return ''
  return `${normalized}${unit === 'day' ? '天' : '小时'}`
}

function parsePreparationDurationHours(durationText) {
  const normalized = String(durationText || '').trim().replace(/^提前\s*/, '').replace(/\s+/g, '')
  const match = normalized.match(/^(\d+(?:\.\d+)?)(?:[-–—~～至到](\d+(?:\.\d+)?))?(小时|时|h|hr|hrs|hour|hours|天|日|d|day|days)$/i)
  if (!match) return null
  const amount = Number(match[2] || match[1])
  if (!Number.isFinite(amount) || amount < 0) return null
  return /^(天|日|d|day|days)$/i.test(match[3]) ? amount * 24 : amount
}

function isValidPreparation(preparation) {
  if (
    !preparation ||
    typeof preparation !== 'object' ||
    Array.isArray(preparation) ||
    !PREP_TYPES.includes(preparation.type)
  ) {
    return false
  }

  if (preparation.type === INSTANT_PREPARATION) {
    return true
  }

  if (typeof preparation.durationText === 'string') return Boolean(preparation.durationText.trim())

  return Number.isFinite(preparation.amount) &&
    preparation.amount > 0 &&
    (preparation.amountEnd === undefined || (Number.isFinite(preparation.amountEnd) && preparation.amountEnd >= preparation.amount)) &&
    PREPARATION_UNITS.has(preparation.unit)
}

function normalizePrepSelections(preparations) {
  if (!Array.isArray(preparations)) {
    return []
  }

  const uniquePreparations = []
  const seenTypes = new Set()

  for (const preparation of preparations) {
    const normalizedPreparation = preparation && typeof preparation === 'object' && !Array.isArray(preparation)
      ? { ...preparation, type: normalizePreparationType(preparation.type) }
      : preparation
    if (normalizedPreparation && typeof normalizedPreparation.durationText === 'string') normalizedPreparation.durationText = normalizedPreparation.durationText.trim()
    if (!isValidPreparation(normalizedPreparation) || seenTypes.has(normalizedPreparation.type)) {
      continue
    }

    seenTypes.add(normalizedPreparation.type)
    uniquePreparations.push(normalizedPreparation)
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

  const parsed = parsePreparationDurationHours(getPreparationDurationText(preparation))
  return parsed === null ? Number.POSITIVE_INFINITY : parsed
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
  const servingIngredients = (Array.isArray(recipe && recipe.ingredients) ? recipe.ingredients : [])
    .filter((ingredient) => !(ingredient && ingredient.kind === 'prepared-output'))
  const advanceIngredients = (Array.isArray(recipe && recipe.advancePreparations) ? recipe.advancePreparations : [])
    .flatMap((preparation) => Array.isArray(preparation && preparation.ingredients) ? preparation.ingredients : [])
  const ingredients = [...servingIngredients, ...advanceIngredients]

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
  const rating = options.rating || 'all'
  const untriedOnly = options.untriedOnly === true

  return (Array.isArray(recipes) ? recipes : []).filter((recipe) => {
    const preparations = normalizePrepSelections(recipe.preparations)
    const matchesPreparation = prepType === 'all' || preparations.some(
      ({ type }) => type === prepType
    )
    const matchesMaterials = materialCondition === 'all' ||
      getMaterialReadiness(recipe, materialsById) === materialCondition
    const matchesRating = rating === 'all' || (
      recipe.tried === true && recipe.rating === rating
    )
    const matchesTriedState = !untriedOnly || recipe.tried !== true

    return matchesPreparation && matchesMaterials && matchesRating && matchesTriedState
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
    const firstRating = first && first.tried === true
      ? RATINGS.indexOf(first.rating)
      : -1
    const secondRating = second && second.tried === true
      ? RATINGS.indexOf(second.rating)
      : -1
    const firstRank = firstRating === -1 ? RATINGS.length : firstRating
    const secondRank = secondRating === -1 ? RATINGS.length : secondRating

    return firstRank - secondRank || compareRecent(first, second)
  }

  if (sortKey === 'name') {
    const firstName = String(first.name || '')
    const secondName = String(second.name || '')

    if (firstName < secondName) {
      return -1
    }

    return firstName > secondName ? 1 : 0
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
  getPreparationDurationText,
  getPreparationDurationParts,
  formatPreparationDurationText,
  parsePreparationDurationHours,
  getPrimaryPreparation,
  getMaterialReadiness,
  filterRecipes,
  sortRecipes
}
