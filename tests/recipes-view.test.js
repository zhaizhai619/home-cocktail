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
    tried: true,
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
    gin: { name: '金酒', acquisition: 'long-term', owned: true, alcoholic: true, abv: 40 },
    lime: { name: '青柠', acquisition: 'on-demand', freshOnHand: false, alcoholic: false },
    campari: { name: '金巴利', acquisition: 'long-term', owned: false, alcoholic: true, abv: 25 }
  })

  assert.deepEqual(card, {
    id: 'negroni',
    name: '内格罗尼',
    image: '/images/negroni.png',
    rating: '常喝',
    preparationLabel: '冷冻 · 提前1天',
    abvLabel: '',
    ingredients: [
      { name: '金酒', amountLabel: '30ml', state: 'owned', quickBuyIcon: '', accessibilityLabel: '金酒，30ml，当前可用' },
      { name: '青柠', amountLabel: '1个', state: 'quick-buy', quickBuyIcon: '🛍️', accessibilityLabel: '青柠，1个，可随买随用' },
      { name: '金巴利', amountLabel: '30ml', state: 'missing-long-term', quickBuyIcon: '', accessibilityLabel: '金巴利，30ml，长期材料当前没有' }
    ]
  })
})

test('buildRecipeCard marks an untried recipe instead of showing a stale rating', () => {
  const card = buildRecipeCard({ id: 'later', name: '以后再调', tried: false, rating: '顶尖', ingredients: [] }, {})

  assert.equal(card.untriedLabel, '未调过')
  assert.equal(card.rating, '')
})

test('recipe card shows an optional-time preparation without a dangling separator', () => {
  const card = buildRecipeCard({ id: 'cold', name: '冷冻酒', preparations: [{ type: '冷冻', durationText: '' }], ingredients: [] }, {})

  assert.equal(card.preparationLabel, '冷冻')
})

test('recipe card hides ABV when the recipe contains an embedded prepared output', () => {
  const card = buildRecipeCard({
    id: 'pineapple-rum', name: '菠萝朗姆嗨棒', tried: true,
    ingredients: [{ kind: 'prepared-output', preparationId: 'prep-1', amount: 40, unit: 'ml' }, { materialId: 'soda', amount: null, unit: 'top-up' }],
    advancePreparations: [{ id: 'prep-1', outputName: '菠萝朗姆', ingredients: [{ materialId: 'rum', amount: 500, unit: 'ml' }] }]
  }, { soda: { name: '苏打水', alcoholic: false, acquisition: 'long-term', owned: true } })
  assert.equal(card.abvLabel, '')
  assert.equal(buildRecipeCard({ ...card, id: 'manual-prepared', name: '手动预调', manualAbv: 18, advancePreparations: [{ id: 'prep' }], ingredients: [] }, {}).abvLabel, '18%')
})

test('prepared output turns green only when every advance ingredient is currently available', () => {
  const recipe = {
    id: 'prepared-readiness', name: '预调材料状态', tried: true,
    ingredients: [
      { kind: 'prepared-output', preparationId: 'ready', amount: 60, unit: 'ml' },
      { kind: 'prepared-output', preparationId: 'missing', amount: 30, unit: 'ml' },
      { kind: 'prepared-output', preparationId: 'empty', amount: 10, unit: 'ml' }
    ],
    advancePreparations: [
      { id: 'ready', outputName: '黄瓜汁', ingredients: [{ materialId: 'cucumber' }, { materialId: 'syrup' }] },
      { id: 'missing', outputName: '香料液', ingredients: [{ materialId: 'cinnamon' }, { materialId: 'mint' }] },
      { id: 'empty', outputName: '未填材料', ingredients: [] }
    ]
  }
  const materials = {
    cucumber: { id: 'cucumber', name: '黄瓜', acquisition: 'on-demand', freshOnHand: true },
    syrup: { id: 'syrup', name: '糖浆', acquisition: 'long-term', owned: false, assumedAvailable: true, trackFreshness: false },
    cinnamon: { id: 'cinnamon', name: '肉桂', acquisition: 'long-term', owned: true },
    mint: { id: 'mint', name: '薄荷', acquisition: 'on-demand', freshOnHand: false }
  }

  assert.deepEqual(buildRecipeCard(recipe, materials).ingredients, [
    { name: '黄瓜汁', amountLabel: '60ml', state: 'owned', quickBuyIcon: '', accessibilityLabel: '黄瓜汁，60ml，预调材料齐全' },
    { name: '香料液', amountLabel: '30ml', state: 'prepared', quickBuyIcon: '', accessibilityLabel: '香料液，30ml，预调材料未齐' },
    { name: '未填材料', amountLabel: '10ml', state: 'prepared', quickBuyIcon: '', accessibilityLabel: '未填材料，10ml，预调材料未齐' }
  ])
})

test('recipe cards shorten ordinary syrup while keeping flavored syrup names explicit', () => {
  const card = buildRecipeCard({
    id: 'syrup-names', name: '糖浆显示', tried: true,
    ingredients: [{ materialId: 'ordinary', amount: 15, unit: 'ml' }, { materialId: 'honey', amount: 5, unit: 'ml' }]
  }, {
    ordinary: { id: 'ordinary', name: '普通糖浆', category: 'syrup/staple', acquisition: 'long-term', owned: true, alcoholic: false },
    honey: { id: 'honey', name: '蜂蜜糖浆', category: 'syrup/staple', acquisition: 'long-term', owned: true, alcoholic: false }
  })

  assert.deepEqual(card.ingredients.map(({ name, accessibilityLabel }) => ({ name, accessibilityLabel })), [
    { name: '糖浆', accessibilityLabel: '糖浆，15ml，当前可用' },
    { name: '蜂蜜糖浆', accessibilityLabel: '蜂蜜糖浆，5ml，当前可用' }
  ])
})

test('recipe card renders a text ingredient amount with its unit', () => {
  const card = buildRecipeCard({
    id: 'cucumber', name: '黄瓜酒', tried: true,
    ingredients: [{ materialId: 'cucumber', amount: '半', unit: 'piece' }]
  }, {
    cucumber: { id: 'cucumber', name: '黄瓜', category: 'fruit', acquisition: 'on-demand', freshOnHand: true, alcoholic: false }
  })

  assert.equal(card.ingredients[0].amountLabel, '半个')
})

test('buildRecipeCard safely skips malformed ingredient references', () => {
  const card = buildRecipeCard({
    id: 'safe', name: '安全酒', ingredients: [null, {}, { materialId: 'unknown' }]
  }, {})

  assert.deepEqual(card.ingredients, [])
  assert.equal(card.preparationLabel, '')
  assert.equal(card.abvLabel, '')
})

test('buildRecipeCard hides ABV until every alcoholic material can be calculated', () => {
  const recipe = {
    id: 'incomplete-abv', name: '待补度数', preparations: [{ type: '即调' }],
    ingredients: [
      { materialId: 'gin', amount: 30, unit: 'ml' },
      { materialId: 'liqueur', amount: 15, unit: 'ml' }
    ]
  }
  const materials = {
    gin: { name: '金酒', alcoholic: true, abv: 40 },
    liqueur: { name: '利口酒', alcoholic: true, abv: null }
  }

  assert.equal(buildRecipeCard(recipe, materials).abvLabel, '')
})

test('buildRecipeCard treats prototype-like material ids as missing', () => {
  const card = buildRecipeCard({
    id: 'legacy-orphan', name: '旧数据', preparations: [{ type: '即调' }],
    ingredients: [{ materialId: 'constructor', amount: 30, unit: 'ml' }]
  }, {})

  assert.equal(card.abvLabel, '')
  assert.deepEqual(card.ingredients, [])
})

test('buildRecipeCard accepts an owned __proto__ material from a safe lookup', () => {
  const materials = Object.create(null)
  materials.__proto__ = { id: '__proto__', name: '金酒', alcoholic: true, abv: 40, acquisition: 'long-term', owned: true }
  const card = buildRecipeCard({
    id: 'safe-prototype-id', name: '原型键配方', preparations: [{ type: '即调' }],
    ingredients: [{ materialId: '__proto__', amount: 30, unit: 'ml' }]
  }, materials)

  assert.equal(card.abvLabel, '40%')
  assert.equal(card.ingredients[0].name, '金酒')
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

test('filterAndSortRecipeCards combines rating with preparation and material filters', () => {
  const recipes = [
    { id: 'top', name: '喜欢的酒', tried: true, rating: '顶尖', preparations: [{ type: '即调' }], ingredients: [{ materialId: 'gin' }] },
    { id: 'other-rating', name: '另一杯', tried: true, rating: 'NPC', preparations: [{ type: '即调' }], ingredients: [{ materialId: 'gin' }] },
    { id: 'other-prep', name: '慢酒', tried: true, rating: '顶尖', preparations: [{ type: '奶洗', amount: 1, unit: 'days' }], ingredients: [{ materialId: 'gin' }] }
  ]
  const materials = { gin: { name: '金酒', acquisition: 'long-term', owned: true } }

  assert.deepEqual(
    filterAndSortRecipeCards(recipes, materials, {
      prepType: '即调', materialCondition: 'on-hand', rating: '顶尖'
    }).map(({ id }) => id),
    ['top']
  )
  assert.equal(filterAndSortRecipeCards(recipes, materials, { rating: 'all' }).length, 3)
})

test('filterAndSortRecipeCards keeps tried recipes first while preserving the selected sort inside each group', () => {
  const recipes = [
    { id: 'untried-b', name: 'B', tried: false, ingredients: [] },
    { id: 'tried-b', name: 'B', tried: true, ingredients: [] },
    { id: 'untried-a', name: 'A', tried: false, ingredients: [] },
    { id: 'tried-a', name: 'A', tried: true, ingredients: [] }
  ]

  assert.deepEqual(
    filterAndSortRecipeCards(recipes, {}, { sortKey: 'name' }).map(({ id }) => id),
    ['tried-a', 'tried-b', 'untried-a', 'untried-b']
  )
})

test('filterAndSortRecipeCards shows only untried recipes when the compact switch is active', () => {
  const recipes = [
    { id: 'tried', name: '调过', tried: true, ingredients: [] },
    { id: 'untried-b', name: 'B', tried: false, ingredients: [] },
    { id: 'untried-a', name: 'A', tried: false, ingredients: [] }
  ]

  assert.deepEqual(
    filterAndSortRecipeCards(recipes, {}, { sortKey: 'name', untriedOnly: true }).map(({ id }) => id),
    ['untried-a', 'untried-b']
  )
})

test('untried-only combines search, preparation and material filters but rejects stale ratings', () => {
  const recipes = [
    { id: 'target', name: '目标酒', rating: '顶尖', preparations: [{ type: '即调' }], ingredients: [{ materialId: 'mint' }] },
    { id: 'tried', name: '目标酒', tried: true, rating: '顶尖', preparations: [{ type: '即调' }], ingredients: [{ materialId: 'mint' }] },
    { id: 'wrong-prep', name: '目标酒', tried: false, preparations: [{ type: '奶洗', amount: 1, unit: 'days' }], ingredients: [{ materialId: 'mint' }] },
    { id: 'wrong-material', name: '目标酒', tried: false, preparations: [{ type: '即调' }], ingredients: [{ materialId: 'gin' }] }
  ]
  const materials = {
    mint: { name: '薄荷', acquisition: 'on-demand', freshOnHand: false },
    gin: { name: '金酒', acquisition: 'long-term', owned: true }
  }
  const options = { search: '目标', prepType: '即调', materialCondition: 'fresh-only', rating: 'all', untriedOnly: true, sortKey: 'name' }

  assert.deepEqual(filterAndSortRecipeCards(recipes, materials, options).map(({ id }) => id), ['target'])
  assert.deepEqual(filterAndSortRecipeCards(recipes, materials, { ...options, rating: '顶尖' }), [])
})
