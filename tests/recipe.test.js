const assert = require('node:assert/strict')
const test = require('node:test')

const {
  filterRecipes,
  getMaterialReadiness,
  getPrimaryPreparation,
  normalizePrepSelections,
  sortRecipes
} = require('../miniprogram/domain/recipe')

function recipe(overrides = {}) {
  return {
    id: 'recipe',
    name: '测试酒款',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ingredients: [],
    preparations: [{ type: '即调' }],
    rating: null,
    ...overrides
  }
}

function material(overrides = {}) {
  return {
    acquisition: 'long-term',
    owned: true,
    freshOnHand: false,
    assumedAvailable: false,
    trackFreshness: false,
    ...overrides
  }
}

test('normalizes instant preparation as mutually exclusive without mutation', () => {
  const input = [
    { type: '即调' },
    { type: '冷冻', amount: 4, unit: 'hours', note: '提前冻杯' }
  ]
  const snapshot = structuredClone(input)

  assert.deepEqual(normalizePrepSelections(input), [
    { type: '冷冻', amount: 4, unit: 'hours', note: '提前冻杯' }
  ])
  assert.deepEqual(input, snapshot)
})

test('deduplicates preparation types by keeping the first complete selection', () => {
  const first = { type: '奶洗', amount: 1, unit: 'days', note: '第一次说明' }
  const result = normalizePrepSelections([
    first,
    { type: '奶洗', amount: 2, unit: 'days', note: '重复项' },
    { type: '冷泡/浸泡', amount: 8, unit: 'hours', note: '冷藏' }
  ])

  assert.deepEqual(result, [
    first,
    { type: '冷泡/浸泡', amount: 8, unit: 'hours', note: '冷藏' }
  ])
  assert.notStrictEqual(result[0], first)
})

test('deduplicates instant-only selections deterministically', () => {
  assert.deepEqual(
    normalizePrepSelections([{ type: '即调' }, { type: '即调' }]),
    [{ type: '即调' }]
  )
})

test('returns null when there is no primary preparation', () => {
  assert.equal(getPrimaryPreparation([]), null)
  assert.equal(getPrimaryPreparation(), null)
})

test('uses zero lead time for instant preparation', () => {
  assert.deepEqual(getPrimaryPreparation([{ type: '即调' }]), {
    type: '即调',
    leadHours: 0
  })
})

test('uses the longest preparation after converting days to hours', () => {
  assert.deepEqual(getPrimaryPreparation([
    { type: '冷冻', amount: 20, unit: 'hours', note: '冻透' },
    { type: '奶洗', amount: 1, unit: 'days', note: '过滤' },
    { type: '冷泡/浸泡', amount: 8, unit: 'hours', note: '冷藏' }
  ]), {
    type: '奶洗',
    amount: 1,
    unit: 'days',
    note: '过滤',
    leadHours: 24
  })
})

test('breaks equal preparation lead times by fixed preparation type order', () => {
  assert.deepEqual(getPrimaryPreparation([
    { type: '奶洗', amount: 1, unit: 'days' },
    { type: '冷冻', amount: 24, unit: 'hours' },
    { type: '冷泡/浸泡', amount: 24, unit: 'hours' }
  ]), {
    type: '冷冻',
    amount: 24,
    unit: 'hours',
    leadHours: 24
  })
})

test('classifies recipes whose referenced materials are all available as on-hand', () => {
  const target = recipe({
    ingredients: [{ materialId: 'gin' }, { materialId: 'mint' }]
  })
  const materials = {
    gin: material(),
    mint: material({ acquisition: 'on-demand', freshOnHand: true })
  }

  assert.equal(getMaterialReadiness(target, materials), 'on-hand')
})

test('classifies an unmet on-demand ingredient as fresh-only', () => {
  const target = recipe({ ingredients: [{ materialId: 'mint' }] })
  const materials = {
    mint: material({ acquisition: 'on-demand', freshOnHand: false })
  }

  assert.equal(getMaterialReadiness(target, materials), 'fresh-only')
})

test('prioritizes missing long-term materials over fresh purchase needs', () => {
  const target = recipe({
    ingredients: [{ materialId: 'liqueur' }, { materialId: 'mint' }]
  })
  const materials = {
    liqueur: material({ owned: false }),
    mint: material({ acquisition: 'on-demand', freshOnHand: false })
  }

  assert.equal(getMaterialReadiness(target, materials), 'missing-long-term')
})

test('does not treat unknown material references as on-hand', () => {
  const target = recipe({ ingredients: [{ materialId: 'unknown' }] })

  assert.equal(getMaterialReadiness(target, {}), 'missing-long-term')
})

test('untracked assumed staples do not block on-hand readiness', () => {
  const target = recipe({
    ingredients: [{ materialId: 'lime' }, { materialId: 'syrup' }]
  })
  const materials = {
    lime: material({ assumedAvailable: true, owned: false }),
    syrup: material({ assumedAvailable: true, owned: false })
  }

  assert.equal(getMaterialReadiness(target, materials), 'on-hand')
})

test('tracked assumed staples obey their actual long-term owned state', () => {
  const target = recipe({ ingredients: [{ materialId: 'lime' }] })

  assert.equal(getMaterialReadiness(target, {
    lime: material({ assumedAvailable: true, trackFreshness: true, owned: false })
  }), 'missing-long-term')
  assert.equal(getMaterialReadiness(target, {
    lime: material({ assumedAvailable: true, trackFreshness: true, owned: true })
  }), 'on-hand')
})

test('tracked assumed on-demand staples obey their actual freshness state', () => {
  const target = recipe({ ingredients: [{ materialId: 'juice' }] })

  assert.equal(getMaterialReadiness(target, {
    juice: material({
      acquisition: 'on-demand',
      assumedAvailable: true,
      trackFreshness: true,
      freshOnHand: false
    })
  }), 'fresh-only')
  assert.equal(getMaterialReadiness(target, {
    juice: material({
      acquisition: 'on-demand',
      assumedAvailable: true,
      trackFreshness: true,
      freshOnHand: true
    })
  }), 'on-hand')
})

test('filters recipes by any matching preparation tag without mutation', () => {
  const recipes = [
    recipe({
      id: 'multi',
      preparations: [
        { type: '冷冻', amount: 4, unit: 'hours' },
        { type: '奶洗', amount: 1, unit: 'days' }
      ]
    }),
    recipe({ id: 'instant' })
  ]
  const snapshot = structuredClone(recipes)

  assert.deepEqual(
    filterRecipes(recipes, { prepType: '冷冻', materialCondition: 'all' }, {}),
    [recipes[0]]
  )
  assert.deepEqual(recipes, snapshot)
})

test('filters recipes by on-hand and fresh-only material conditions', () => {
  const recipes = [
    recipe({ id: 'ready', ingredients: [{ materialId: 'gin' }] }),
    recipe({ id: 'fresh', ingredients: [{ materialId: 'mint' }] }),
    recipe({ id: 'missing', ingredients: [{ materialId: 'liqueur' }] })
  ]
  const materials = {
    gin: material(),
    mint: material({ acquisition: 'on-demand', freshOnHand: false }),
    liqueur: material({ owned: false })
  }

  assert.deepEqual(
    filterRecipes(recipes, { prepType: 'all', materialCondition: 'on-hand' }, materials),
    [recipes[0]]
  )
  assert.deepEqual(
    filterRecipes(recipes, { prepType: 'all', materialCondition: 'fresh-only' }, materials),
    [recipes[1]]
  )
})

test('combines instant preparation and fresh-only material filters', () => {
  const recipes = [
    recipe({ id: 'instant-fresh', ingredients: [{ materialId: 'mint' }] }),
    recipe({
      id: 'frozen-fresh',
      ingredients: [{ materialId: 'mint' }],
      preparations: [{ type: '冷冻', amount: 2, unit: 'hours' }]
    }),
    recipe({ id: 'instant-ready', ingredients: [{ materialId: 'gin' }] })
  ]
  const materials = {
    mint: material({ acquisition: 'on-demand', freshOnHand: false }),
    gin: material()
  }

  assert.deepEqual(
    filterRecipes(recipes, { prepType: '即调', materialCondition: 'fresh-only' }, materials),
    [recipes[0]]
  )
})

test('sorts preparation time ascending then creation time descending without mutation', () => {
  const recipes = [
    recipe({
      id: 'day-old',
      createdAt: '2026-07-01T00:00:00.000Z',
      preparations: [{ type: '奶洗', amount: 1, unit: 'days' }]
    }),
    recipe({
      id: 'instant',
      createdAt: '2026-07-02T00:00:00.000Z'
    }),
    recipe({
      id: 'day-new',
      createdAt: '2026-07-03T00:00:00.000Z',
      preparations: [
        { type: '冷冻', amount: 4, unit: 'hours' },
        { type: '冷泡/浸泡', amount: 1, unit: 'days' }
      ]
    }),
    recipe({
      id: 'hours',
      createdAt: '2026-07-04T00:00:00.000Z',
      preparations: [{ type: '冷冻', amount: 8, unit: 'hours' }]
    })
  ]
  const snapshot = recipes.slice()

  assert.deepEqual(
    sortRecipes(recipes, 'prep-time').map(({ id }) => id),
    ['instant', 'hours', 'day-new', 'day-old']
  )
  assert.deepEqual(recipes, snapshot)
})

test('sorts recently created recipes descending', () => {
  const recipes = [
    recipe({ id: 'old', createdAt: '2026-07-01T00:00:00.000Z' }),
    recipe({ id: 'new', createdAt: '2026-07-20T00:00:00.000Z' }),
    recipe({ id: 'middle', createdAt: '2026-07-10T00:00:00.000Z' })
  ]

  assert.deepEqual(
    sortRecipes(recipes, 'recent').map(({ id }) => id),
    ['new', 'middle', 'old']
  )
})

test('sorts ratings by fixed rank with unrated last and recent ties first', () => {
  const recipes = [
    recipe({ id: 'unrated-new', createdAt: '2026-07-30T00:00:00.000Z' }),
    recipe({ id: 'npc', rating: 'NPC' }),
    recipe({ id: 'top-old', rating: '夯', createdAt: '2026-07-01T00:00:00.000Z' }),
    recipe({ id: 'worst', rating: '拉完了' }),
    recipe({ id: 'top-new', rating: '夯', createdAt: '2026-07-10T00:00:00.000Z' }),
    recipe({ id: 'excellent', rating: '顶尖' }),
    recipe({ id: 'above', rating: '人上人' })
  ]

  assert.deepEqual(
    sortRecipes(recipes, 'rating').map(({ id }) => id),
    ['top-new', 'top-old', 'excellent', 'above', 'npc', 'worst', 'unrated-new']
  )
})

test('sorts names deterministically and preserves order for equal names', () => {
  const recipes = [
    recipe({ id: 'b', name: 'Beta' }),
    recipe({ id: 'a-first', name: 'Alpha' }),
    recipe({ id: 'a-second', name: 'Alpha' })
  ]

  assert.deepEqual(
    sortRecipes(recipes, 'name').map(({ id }) => id),
    ['a-first', 'a-second', 'b']
  )
})
