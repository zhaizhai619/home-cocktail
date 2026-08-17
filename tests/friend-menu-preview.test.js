const assert = require('node:assert/strict')
const test = require('node:test')

const friendMenus = require('../miniprogram/services/friend-menu-preview')

function context(id = 'menu-alice', recipeId = 'recipe-one') {
  return {
    menu: { id, name: 'Alice的酒单', ownerName: 'Alice', updatedLabel: '刚刚' },
    recipes: [{ id: recipeId, name: '测试酒', ingredients: [], preparations: [], steps: [] }],
    materials: [],
    glassware: [],
    tools: []
  }
}

test('production friend menu store starts empty without bundled examples', () => {
  assert.deepEqual(friendMenus.listMenus(), [])
  assert.equal(friendMenus.getMenu('menu-alice').status, 'missing-menu')
})

test('an injected friend menu store returns defensive menu and recipe context', () => {
  const store = friendMenus.createFriendMenuStore([context()])
  const menus = store.listMenus()

  assert.deepEqual(menus, [{ id: 'menu-alice', name: 'Alice的酒单', ownerName: 'Alice', recipeCount: 1, updatedLabel: '刚刚' }])
  menus[0].name = '被修改'
  assert.equal(store.listMenus()[0].name, 'Alice的酒单')

  const result = store.getMenu('menu-alice')
  result.recipes[0].name = '被修改'
  assert.equal(store.getMenu('menu-alice').recipes[0].name, '测试酒')
})

test('friend recipe lookup validates menu membership', () => {
  const store = friendMenus.createFriendMenuStore([
    context('menu-alice', 'recipe-one'),
    context('menu-bob', 'recipe-two')
  ])

  assert.equal(store.getRecipe('menu-alice', 'recipe-one').status, 'ok')
  assert.equal(store.getRecipe('menu-alice', 'recipe-two').status, 'recipe-not-in-menu')
  assert.equal(store.getRecipe('menu-alice', 'recipe-missing').status, 'missing-recipe')
  assert.equal(store.getRecipe('menu-missing', 'recipe-one').status, 'missing-menu')
})

test('malformed encoded ids never throw', () => {
  const store = friendMenus.createFriendMenuStore([context()])
  assert.deepEqual(friendMenus.decodePreviewId('%E0%A4%A'), { ok: false, reason: 'malformed-id' })
  assert.equal(store.getMenu('%E0%A4%A').status, 'malformed-id')
  assert.equal(store.getRecipe('menu-alice', '%E0%A4%A').status, 'malformed-id')
})

test('a viewer can rename a received menu without changing author identity', () => {
  const store = friendMenus.createFriendMenuStore([context()])
  const renamed = store.renameMenu('menu-alice', '周末调酒参考')

  assert.equal(renamed.status, 'ok')
  assert.equal(renamed.menu.name, '周末调酒参考')
  assert.equal(renamed.menu.ownerName, 'Alice')
  assert.equal(store.getMenu('menu-alice').menu.name, '周末调酒参考')
  assert.equal(store.renameMenu('menu-alice', '   ').status, 'invalid-name')
})

test('received menu contexts are validated before entering the store', () => {
  const store = friendMenus.createFriendMenuStore()
  assert.equal(store.receiveMenu({}).status, 'invalid-menu')
  assert.equal(store.receiveMenu(context()).status, 'ok')
  assert.equal(store.listMenus().length, 1)
})
