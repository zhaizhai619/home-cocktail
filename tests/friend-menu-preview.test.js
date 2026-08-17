const assert = require('node:assert/strict')
const test = require('node:test')

const preview = require('../miniprogram/services/friend-menu-preview')

test('friend menu preview exposes an isolated menu collection', () => {
  const menus = preview.listMenus()

  assert.equal(menus.length, 1)
  assert.deepEqual(menus[0], {
    id: 'preview-mengqi',
    name: '孟琪的酒单',
    ownerName: '孟琪',
    recipeCount: 3,
    updatedLabel: '今天 18:32'
  })

  menus[0].name = '被修改'
  assert.equal(preview.listMenus()[0].name, '孟琪的酒单')
})

test('friend menu lookup returns defensive recipe and material context', () => {
  const result = preview.getMenu('preview-mengqi')

  assert.equal(result.status, 'ok')
  assert.equal(result.menu.ownerName, '孟琪')
  assert.deepEqual(result.recipes.map(({ id }) => id), [
    'preview-negroni',
    'preview-whiskey-sour',
    'preview-mojito'
  ])
  assert.ok(result.materials.length > 0)

  result.recipes[0].name = '被修改'
  assert.equal(preview.getMenu('preview-mengqi').recipes[0].name, '尼格罗尼')
})

test('friend recipe must belong to the supplied menu', () => {
  assert.equal(preview.getRecipe('preview-mengqi', 'preview-negroni').status, 'ok')
  assert.equal(preview.getRecipe('preview-mengqi', 'preview-not-in-menu').status, 'recipe-not-in-menu')
  assert.equal(preview.getRecipe('preview-missing-menu', 'preview-negroni').status, 'missing-menu')
})

test('malformed encoded ids never throw', () => {
  assert.deepEqual(preview.decodePreviewId('%E0%A4%A'), { ok: false, reason: 'malformed-id' })
  assert.equal(preview.getMenu('%E0%A4%A').status, 'malformed-id')
  assert.equal(preview.getRecipe('preview-mengqi', '%E0%A4%A').status, 'malformed-id')
})

test('friend menu identity uses the author profile name without a generated avatar initial', () => {
  const menu = preview.listMenus()[0]
  assert.equal(menu.ownerName, '孟琪')
  assert.equal(menu.name, '孟琪的酒单')
  assert.equal(Object.prototype.hasOwnProperty.call(menu, 'ownerInitial'), false)
})
