const assert = require('node:assert/strict')
const test = require('node:test')

const {
  buildRecipeCard,
  filterAndSortRecipeCards
} = require('../miniprogram/pages/recipes/model')

test('buildRecipeCard shows its longest preparation and material visual states', () => {
  const card = buildRecipeCard({
    id: 'negroni',
    name: '内格罗尼',
    image: '/images/negroni.png',
    rating: '常喝',
    preparations: [
      { type: '即调' },
      { type: '冷冻', amount: 1, unit: 'days' }
    ],
    ingredients: [
      { materialId: 'gin', amount: 30, unit: 'ml' },
      { materialId: 'lime', amount: 1, unit: '个' },
      { materialId: 'campari', amount: 30, unit: 'ml' }
    ]
  }, {
    gin: { name: '金酒', acquisition: 'long-term', owned: true },
    lime: { name: '青柠', acquisition: 'on-demand', freshOnHand: false },
    campari: { name: '金巴利', acquisition: 'long-term', owned: false }
  })

  assert.deepEqual(card, {
    id: 'negroni',
    name: '内格罗尼',
    image: '/images/negroni.png',
    rating: '常喝',
    preparationLabel: '冷冻 · 提前1天',
    ingredients: [
      { name: '金酒', amountLabel: '30ml', state: 'owned', quickBuyMarker: '' },
      { name: '青柠', amountLabel: '1个', state: 'quick-buy', quickBuyMarker: '需购' },
      { name: '金巴利', amountLabel: '30ml', state: 'missing-long-term', quickBuyMarker: '' }
    ]
  })
})

test('buildRecipeCard safely skips malformed ingredient references', () => {
  const card = buildRecipeCard({
    id: 'safe', name: '安全酒', ingredients: [null, {}, { materialId: 'unknown' }]
  }, {})

  assert.deepEqual(card.ingredients, [])
  assert.equal(card.preparationLabel, '')
})

test('filterAndSortRecipeCards searches recipe and material names after trimming input', () => {
  const recipes = [
    { id: 'a', name: '金酒菲兹', createdAt: '2026-01-01', preparations: [{ type: '即调' }], ingredients: [{ materialId: 'gin' }] },
    { id: 'b', name: '夏日杯', createdAt: '2026-02-01', preparations: [{ type: '即调' }], ingredients: [{ materialId: 'lime' }] }
  ]
  const materials = {
    gin: { name: '金酒', acquisition: 'long-term', owned: true },
    lime: { name: '青柠', acquisition: 'on-demand', freshOnHand: false }
  }

  assert.deepEqual(
    filterAndSortRecipeCards(recipes, materials, { search: '  青柠  ', sortKey: 'recent' }).map(({ id }) => id),
    ['b']
  )
})

test('filterAndSortRecipeCards delegates preparation and material filters plus sorting without mutation', () => {
  const recipes = [
    { id: 'slow', name: '慢酒', createdAt: '2026-01-01', preparations: [{ type: '冷泡', amount: 8, unit: 'hours' }], ingredients: [{ materialId: 'tea' }] },
    { id: 'quick', name: '快酒', createdAt: '2026-02-01', preparations: [{ type: '即调' }], ingredients: [{ materialId: 'mint' }] }
  ]
  const snapshot = structuredClone(recipes)
  const materials = {
    tea: { name: '茶', acquisition: 'long-term', owned: true },
    mint: { name: '薄荷', acquisition: 'on-demand', freshOnHand: false }
  }

  assert.deepEqual(
    filterAndSortRecipeCards(recipes, materials, {
      prepType: '即调', materialCondition: 'fresh-only', sortKey: 'prep-time'
    }).map(({ id }) => id),
    ['quick']
  )
  assert.deepEqual(recipes, snapshot)
})
