const { getMaterialDisplayName, getMaterialVisualState, materialNameMatchesQuery } = require('../../domain/material')
const { calculateAbv, recipeIngredientsForAbv } = require('../../domain/abv')
const { UNITS } = require('../../domain/constants')
const {
  filterRecipes,
  getPreparationDurationText,
  getPrimaryPreparation,
  sortRecipes
} = require('../../domain/recipe')

const UNIT_LABELS = UNITS.reduce((labels, unit) => {
  labels[unit.value] = unit.label
  return labels
}, {})

function formatPreparation(primary) {
  if (!primary) return ''
  if (primary.type === '即调') return '即调'
  const duration = getPreparationDurationText(primary)
  return `${primary.type} · ${duration.startsWith('提前') ? duration : `提前${duration}`}`
}

function formatAmount(ingredient) {
  if (ingredient && ingredient.unit === 'top-up') return '补满'
  if (ingredient && ingredient.unit === 'to-taste') return '适量'
  if (!ingredient || ingredient.amount === null || ingredient.amount === undefined || String(ingredient.amount).trim() === '') return ''
  return `${String(ingredient.amount).trim()}${UNIT_LABELS[ingredient.unit] || ingredient.unit || ''}`
}

function buildRecipeCard(recipe, materialsById = {}) {
  const source = recipe && typeof recipe === 'object' ? recipe : {}
  const ingredients = Array.isArray(source.ingredients) ? source.ingredients : []
  const advancePreparations = Array.isArray(source.advancePreparations) ? source.advancePreparations : []
  const preparationsById = advancePreparations.reduce((lookup, preparation) => {
    if (preparation && preparation.id) lookup[preparation.id] = preparation
    return lookup
  }, Object.create(null))
  const safeMaterials = materialsById && typeof materialsById === 'object' ? materialsById : {}
  const abv = advancePreparations.length ? { status: 'prepared' } : calculateAbv(recipeIngredientsForAbv(source, safeMaterials))
  const tried = source.tried === true

  return {
    id: typeof source.id === 'string' ? source.id : '',
    name: typeof source.name === 'string' ? source.name : '',
    image: typeof source.imagePath === 'string' && source.imagePath
      ? source.imagePath
      : (typeof source.image === 'string' ? source.image : ''),
    rating: tried && typeof source.rating === 'string' ? source.rating : '',
    ...(tried ? {} : { untriedLabel: '未调过' }),
    preparationLabel: formatPreparation(getPrimaryPreparation(source.preparations)),
    abvLabel: abv.status === 'ok' ? `${abv.abv}%` : '',
    ingredients: ingredients.reduce((items, ingredient) => {
      if (ingredient && ingredient.kind === 'prepared-output') {
        const preparation = preparationsById[ingredient.preparationId]
        if (!preparation) return items
        const name = String(preparation.outputName || '预调成品').trim() || '预调成品'
        const amountLabel = formatAmount(ingredient)
        items.push({ name, amountLabel, state: 'prepared', quickBuyIcon: '', accessibilityLabel: [name, amountLabel].filter(Boolean).join('，') })
        return items
      }
      if (!ingredient || typeof ingredient.materialId !== 'string') return items
      const material = Object.prototype.hasOwnProperty.call(safeMaterials, ingredient.materialId) && safeMaterials[ingredient.materialId] && typeof safeMaterials[ingredient.materialId] === 'object'
        ? safeMaterials[ingredient.materialId]
        : null
      if (!material || typeof material.name !== 'string' || !material.name) return items
      const state = getMaterialVisualState(material)
      const availabilityText = {
        owned: '当前可用',
        'quick-buy': '可随买随用',
        'missing-long-term': '长期材料当前没有'
      }[state]
      const amountLabel = formatAmount(ingredient)
      const displayName = getMaterialDisplayName(material.category, material.name)
      items.push({
        name: displayName,
        amountLabel,
        state,
        quickBuyIcon: state === 'quick-buy' ? '🛍' : '',
        accessibilityLabel: [displayName, amountLabel, availabilityText].filter(Boolean).join('，')
      })
      return items
    }, [])
  }
}

function matchesSearch(recipe, materialsById, search) {
  const query = String(search || '').trim().toLowerCase()
  if (!query) return true
  const name = String(recipe && recipe.name || '').toLowerCase()
  if (name.includes(query)) return true
  const advancePreparations = Array.isArray(recipe && recipe.advancePreparations) ? recipe.advancePreparations : []
  if (advancePreparations.some((preparation) => String(preparation && preparation.outputName || '').toLowerCase().includes(query))) return true
  const ingredients = [...(Array.isArray(recipe && recipe.ingredients) ? recipe.ingredients : []).filter((ingredient) => ingredient && ingredient.kind !== 'prepared-output'), ...advancePreparations.flatMap((preparation) => Array.isArray(preparation && preparation.ingredients) ? preparation.ingredients : [])]
  return ingredients.some((ingredient) => {
    const material = ingredient && materialsById[ingredient.materialId]
    return material && materialNameMatchesQuery(material.category, material.name, query)
  })
}

function filterAndSortRecipeCards(recipes, materialsById = {}, options = {}) {
  const safeRecipes = Array.isArray(recipes) ? recipes : []
  const searched = safeRecipes.filter((recipe) => matchesSearch(recipe, materialsById, options.search))
  const filtered = filterRecipes(searched, options, materialsById)
  const sorted = sortRecipes(filtered, options.sortKey || 'prep-time')
  const grouped = options.untriedOnly === true
    ? sorted
    : [...sorted.filter((recipe) => recipe && recipe.tried === true), ...sorted.filter((recipe) => !recipe || recipe.tried !== true)]
  return grouped.map((recipe) => buildRecipeCard(recipe, materialsById))
}

module.exports = { buildRecipeCard, filterAndSortRecipeCards }
