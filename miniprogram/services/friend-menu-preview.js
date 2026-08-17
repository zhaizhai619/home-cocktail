function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function decodePreviewId(value) {
  if (typeof value !== 'string' || !value) return { ok: false, reason: 'malformed-id' }
  try {
    const decoded = decodeURIComponent(value)
    return decoded ? { ok: true, value: decoded } : { ok: false, reason: 'malformed-id' }
  } catch (_) {
    return { ok: false, reason: 'malformed-id' }
  }
}

function normalizeContext(value) {
  const source = value && typeof value === 'object' ? value : {}
  const menu = source.menu && typeof source.menu === 'object' ? source.menu : {}
  if (typeof menu.id !== 'string' || !menu.id || typeof menu.name !== 'string' || !menu.name.trim()) return null
  return {
    menu: {
      id: menu.id,
      name: menu.name.trim(),
      ownerName: typeof menu.ownerName === 'string' ? menu.ownerName.trim() : '',
      updatedLabel: typeof menu.updatedLabel === 'string' ? menu.updatedLabel : ''
    },
    recipes: (Array.isArray(source.recipes) ? source.recipes : []).filter((recipe) => recipe && typeof recipe.id === 'string' && recipe.id),
    materials: Array.isArray(source.materials) ? source.materials : [],
    glassware: Array.isArray(source.glassware) ? source.glassware : [],
    tools: Array.isArray(source.tools) ? source.tools : []
  }
}

function createFriendMenuStore(initialContexts = []) {
  const contexts = Object.create(null)
  const orderedIds = []
  const displayNames = Object.create(null)

  function menuSummary(context) {
    return {
      id: context.menu.id,
      name: displayNames[context.menu.id] || context.menu.name,
      ownerName: context.menu.ownerName,
      recipeCount: context.recipes.length,
      updatedLabel: context.menu.updatedLabel
    }
  }

  function receiveMenu(value) {
    const context = normalizeContext(value)
    if (!context) return { status: 'invalid-menu' }
    if (!Object.prototype.hasOwnProperty.call(contexts, context.menu.id)) orderedIds.push(context.menu.id)
    contexts[context.menu.id] = clone(context)
    return { status: 'ok', menu: clone(menuSummary(contexts[context.menu.id])) }
  }

  function listMenus() {
    return clone(orderedIds.map((id) => menuSummary(contexts[id])))
  }

  function getMenu(rawMenuId) {
    const decoded = decodePreviewId(rawMenuId)
    if (!decoded.ok) return { status: decoded.reason }
    const context = contexts[decoded.value]
    if (!context) return { status: 'missing-menu' }
    return clone({
      status: 'ok',
      menu: menuSummary(context),
      recipes: context.recipes,
      materials: context.materials,
      glassware: context.glassware,
      tools: context.tools
    })
  }

  function getRecipe(rawMenuId, rawRecipeId) {
    const menuResult = getMenu(rawMenuId)
    if (menuResult.status !== 'ok') return menuResult
    const decodedRecipe = decodePreviewId(rawRecipeId)
    if (!decodedRecipe.ok) return { status: decodedRecipe.reason }
    const recipe = menuResult.recipes.find(({ id }) => id === decodedRecipe.value)
    if (!recipe) {
      const existsElsewhere = orderedIds.some((id) => contexts[id].recipes.some(({ id: recipeId }) => recipeId === decodedRecipe.value))
      return { status: existsElsewhere ? 'recipe-not-in-menu' : 'missing-recipe' }
    }
    return clone({ ...menuResult, recipe })
  }

  function renameMenu(rawMenuId, value) {
    const decoded = decodePreviewId(rawMenuId)
    if (!decoded.ok) return { status: decoded.reason }
    const context = contexts[decoded.value]
    if (!context) return { status: 'missing-menu' }
    const name = String(value || '').trim()
    if (!name || name.length > 30) return { status: 'invalid-name' }
    displayNames[context.menu.id] = name
    return { status: 'ok', menu: clone(menuSummary(context)) }
  }

  ;(Array.isArray(initialContexts) ? initialContexts : []).forEach(receiveMenu)
  return { listMenus, getMenu, getRecipe, renameMenu, receiveMenu }
}

const defaultStore = createFriendMenuStore()

module.exports = {
  decodePreviewId,
  createFriendMenuStore,
  listMenus: defaultStore.listMenus,
  getMenu: defaultStore.getMenu,
  getRecipe: defaultStore.getRecipe,
  renameMenu: defaultStore.renameMenu,
  receiveMenu: defaultStore.receiveMenu
}
