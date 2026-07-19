const { getMaterialVisualState } = require('../../domain/material')
const {
  filterRecipes,
  getPrimaryPreparation,
  sortRecipes
} = require('../../domain/recipe')

function formatPreparation(primary) {
  if (!primary) return ''
  if (primary.type === '即调') return '即调'
  const unit = primary.unit === 'day' || primary.unit === 'days' || primary.unit === '天'
    ? '天'
    : '小时'
  return `${primary.type} · 提前${primary.amount}${unit}`
}

function formatAmount(ingredient) {
  if (!ingredient || !Number.isFinite(ingredient.amount)) return ''
  return `${ingredient.amount}${ingredient.unit || ''}`
}

function buildRecipeCard(recipe, materialsById = {}) {
  const source = recipe && typeof recipe === 'object' ? recipe : {}
  const ingredients = Array.isArray(source.ingredients) ? source.ingredients : []
  const safeMaterials = materialsById && typeof materialsById === 'object' ? materialsById : {}

  return {
    id: typeof source.id === 'string' ? source.id : '',
    name: typeof source.name === 'string' ? source.name : '',
    image: typeof source.imagePath === 'string' && source.imagePath
      ? source.imagePath
      : (typeof source.image === 'string' ? source.image : ''),
    rating: typeof source.rating === 'string' ? source.rating : '',
    preparationLabel: formatPreparation(getPrimaryPreparation(source.preparations)),
    ingredients: ingredients.reduce((items, ingredient) => {
      if (!ingredient || typeof ingredient.materialId !== 'string') return items
      const material = safeMaterials[ingredient.materialId]
      if (!material || typeof material.name !== 'string' || !material.name) return items
      const state = getMaterialVisualState(material)
      items.push({
        name: material.name,
        amountLabel: formatAmount(ingredient),
        state,
        quickBuyMarker: state === 'quick-buy' ? '需购' : ''
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
  const ingredients = Array.isArray(recipe && recipe.ingredients) ? recipe.ingredients : []
  return ingredients.some((ingredient) => {
    const material = ingredient && materialsById[ingredient.materialId]
    return String(material && material.name || '').toLowerCase().includes(query)
  })
}

function filterAndSortRecipeCards(recipes, materialsById = {}, options = {}) {
  const safeRecipes = Array.isArray(recipes) ? recipes : []
  const searched = safeRecipes.filter((recipe) => matchesSearch(recipe, materialsById, options.search))
  const filtered = filterRecipes(searched, options, materialsById)
  return sortRecipes(filtered, options.sortKey || 'prep-time')
    .map((recipe) => buildRecipeCard(recipe, materialsById))
}

module.exports = { buildRecipeCard, filterAndSortRecipeCards }
