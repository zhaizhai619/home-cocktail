const MENUS = [{
  id: 'preview-mengqi',
  name: '孟琪的私人酒单',
  ownerName: '孟琪',
  ownerInitial: '孟',
  updatedLabel: '今天 18:32',
  recipeIds: ['preview-negroni', 'preview-whiskey-sour', 'preview-mojito']
}]

const MATERIALS = [
  { id: 'preview-gin', name: '金酒', category: 'base-spirit', acquisition: 'long-term', owned: true, alcoholic: true, abv: 40 },
  { id: 'preview-campari', name: '金巴利', category: 'liqueur', acquisition: 'long-term', owned: true, alcoholic: true, abv: 25 },
  { id: 'preview-vermouth', name: '甜味美思', category: 'fortified-wine', acquisition: 'long-term', owned: true, alcoholic: true, abv: 16 },
  { id: 'preview-bourbon', name: '波本威士忌', category: 'base-spirit', acquisition: 'long-term', owned: true, alcoholic: true, abv: 40 },
  { id: 'preview-lemon', name: '柠檬汁', category: 'citrus', acquisition: 'on-demand', freshOnHand: true, alcoholic: false },
  { id: 'preview-syrup', name: '糖浆', category: 'syrup', acquisition: 'long-term', owned: true, alcoholic: false },
  { id: 'preview-rum', name: '白朗姆', category: 'base-spirit', acquisition: 'long-term', owned: true, alcoholic: true, abv: 40 },
  { id: 'preview-lime', name: '青柠汁', category: 'citrus', acquisition: 'on-demand', freshOnHand: true, alcoholic: false },
  { id: 'preview-mint', name: '薄荷叶', category: 'herb', acquisition: 'on-demand', freshOnHand: true, alcoholic: false },
  { id: 'preview-soda', name: '苏打水', category: 'soda/tonic', acquisition: 'on-demand', freshOnHand: true, alcoholic: false }
]

const RECIPES = [
  {
    id: 'preview-negroni', name: '尼格罗尼', source: '孟琪的配方', tried: true, rating: '顶尖',
    ingredients: [
      { materialId: 'preview-gin', amount: 30, unit: 'ml' },
      { materialId: 'preview-campari', amount: 30, unit: 'ml' },
      { materialId: 'preview-vermouth', amount: 30, unit: 'ml' }
    ],
    preparations: [{ type: '即调' }],
    steps: ['将所有材料加入装满冰块的搅拌杯', '搅拌至充分冰镇后滤入加有大冰块的杯中', '挤压橙皮精油后作为装饰'],
    tastingNote: '苦甜平衡很好，橙皮香气出来后更耐喝。',
    createdAt: '2026-08-11T10:00:00.000Z', updatedAt: '2026-08-17T10:32:00.000Z'
  },
  {
    id: 'preview-whiskey-sour', name: '威士忌酸', source: '孟琪的配方', tried: true, rating: '人上人',
    ingredients: [
      { materialId: 'preview-bourbon', amount: 50, unit: 'ml' },
      { materialId: 'preview-lemon', amount: 25, unit: 'ml' },
      { materialId: 'preview-syrup', amount: 15, unit: 'ml' }
    ],
    preparations: [{ type: '即调' }],
    steps: ['所有材料加冰充分摇和', '双重过滤到装有冰块的杯中'],
    tastingNote: '酸度清晰但不尖，波本的香草甜感很舒服。',
    createdAt: '2026-08-09T09:00:00.000Z', updatedAt: '2026-08-16T08:00:00.000Z'
  },
  {
    id: 'preview-mojito', name: '莫吉托', source: '孟琪的配方', tried: true, rating: '夯',
    ingredients: [
      { materialId: 'preview-rum', amount: 45, unit: 'ml' },
      { materialId: 'preview-lime', amount: 20, unit: 'ml' },
      { materialId: 'preview-syrup', amount: 15, unit: 'ml' },
      { materialId: 'preview-mint', amount: 8, unit: 'piece' },
      { materialId: 'preview-soda', amount: null, unit: 'top-up' }
    ],
    preparations: [{ type: '即调' }],
    steps: ['轻拍薄荷后与朗姆、青柠汁和糖浆加入杯中', '加碎冰搅拌，补满苏打水'],
    tastingNote: '薄荷只轻拍会更清爽，不会有明显草涩味。',
    createdAt: '2026-08-07T08:00:00.000Z', updatedAt: '2026-08-15T07:00:00.000Z'
  },
  { id: 'preview-not-in-menu', name: '未加入当前酒单', ingredients: [] }
]

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

function menuSummary(menu) {
  return {
    id: menu.id,
    name: menu.name,
    ownerName: menu.ownerName,
    ownerInitial: menu.ownerInitial,
    recipeCount: menu.recipeIds.length,
    updatedLabel: menu.updatedLabel
  }
}

function listMenus() {
  return clone(MENUS.map(menuSummary))
}

function getMenu(rawMenuId) {
  const decoded = decodePreviewId(rawMenuId)
  if (!decoded.ok) return { status: decoded.reason }
  const menu = MENUS.find(({ id }) => id === decoded.value)
  if (!menu) return { status: 'missing-menu' }
  const recipes = menu.recipeIds.map((id) => RECIPES.find((recipe) => recipe.id === id)).filter(Boolean)
  return clone({
    status: 'ok',
    menu: menuSummary(menu),
    recipes,
    materials: MATERIALS,
    glassware: [],
    tools: []
  })
}

function getRecipe(rawMenuId, rawRecipeId) {
  const menuResult = getMenu(rawMenuId)
  if (menuResult.status !== 'ok') return menuResult
  const decodedRecipe = decodePreviewId(rawRecipeId)
  if (!decodedRecipe.ok) return { status: decodedRecipe.reason }
  const recipe = RECIPES.find(({ id }) => id === decodedRecipe.value)
  if (!recipe) return { status: 'missing-recipe' }
  if (!menuResult.recipes.some(({ id }) => id === recipe.id)) return { status: 'recipe-not-in-menu' }
  return clone({ ...menuResult, recipe })
}

module.exports = { decodePreviewId, listMenus, getMenu, getRecipe }
