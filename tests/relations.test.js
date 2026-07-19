const assert = require('node:assert/strict')
const test = require('node:test')

const {
  getRecipesUsingMaterial,
  getMaterialUsageStats,
  hydrateRecipeSummary,
  getMaterialPreferenceNotes
} = require('../miniprogram/domain/relations')

function material(overrides = {}) {
  return {
    acquisition: 'long-term',
    owned: true,
    assumedAvailable: false,
    trackFreshness: false,
    ...overrides
  }
}

test('finds each using recipe once in input order without mutation', () => {
  const recipes = [
    { id: 'first', ingredients: [{ materialId: 'gin' }, { materialId: 'gin' }] },
    null,
    { id: 'malformed', ingredients: [null, 'gin', {}] },
    { id: 'other', ingredients: [{ materialId: 'rum' }] },
    { id: 'last', ingredients: [{ materialId: 'gin' }] }
  ]
  const snapshot = structuredClone(recipes)

  assert.deepEqual(
    getRecipesUsingMaterial('gin', recipes).map(({ id }) => id),
    ['first', 'last']
  )
  assert.deepEqual(getRecipesUsingMaterial('gin'), [])
  assert.deepEqual(recipes, snapshot)
})

test('counts usage and recipes unlocked by buying one missing long-term material', () => {
  const recipes = [
    {
      id: 'a',
      ingredients: [{ materialId: 'target' }, { materialId: 'gin' }]
    },
    {
      id: 'b',
      ingredients: [{ materialId: 'target' }, { materialId: 'liqueur' }]
    },
    {
      id: 'c',
      ingredients: [
        { materialId: 'target' },
        { materialId: 'target' },
        { materialId: 'mint' }
      ]
    },
    { id: 'd', ingredients: [{ materialId: 'gin' }] }
  ]
  const materialsById = {
    target: material({ owned: false }),
    gin: material(),
    liqueur: material({ owned: false }),
    mint: material({ acquisition: 'on-demand', owned: false })
  }
  const snapshot = structuredClone({ recipes, materialsById })

  assert.deepEqual(
    getMaterialUsageStats('target', recipes, materialsById),
    { usageCount: 3, immediateUnlockCount: 2 }
  )
  assert.deepEqual({ recipes, materialsById }, snapshot)
})

test('unknown references block unlock while untracked staples do not', () => {
  const recipes = [
    {
      id: 'unknown-blocker',
      ingredients: [{ materialId: 'target' }, { materialId: 'unknown' }]
    },
    {
      id: 'assumed-staple',
      ingredients: [{ materialId: 'target' }, { materialId: 'syrup' }]
    },
    { id: 'malformed-row', ingredients: [{ materialId: 'target' }, null] }
  ]
  const materialsById = {
    target: material({ owned: false }),
    syrup: material({
      owned: false,
      assumedAvailable: true,
      trackFreshness: false
    })
  }

  assert.deepEqual(
    getMaterialUsageStats('target', recipes, materialsById),
    { usageCount: 3, immediateUnlockCount: 1 }
  )
})

test('does not claim unlocks for an owned, unknown, or on-demand target', () => {
  const recipes = [{ ingredients: [{ materialId: 'target' }] }]

  for (const materialsById of [
    { target: material({ owned: true }) },
    {},
    { target: material({ acquisition: 'on-demand', owned: false }) }
  ]) {
    assert.deepEqual(
      getMaterialUsageStats('target', recipes, materialsById),
      { usageCount: 1, immediateUnlockCount: 0 }
    )
  }

  assert.deepEqual(getMaterialUsageStats('target'), {
    usageCount: 0,
    immediateUnlockCount: 0
  })
})

test('hydrates recipe relationship objects while retaining their IDs', () => {
  const recipe = {
    id: 'martini',
    name: 'Martini',
    image: '/images/martini.png',
    preparations: [{ type: '即调' }],
    rating: '夸',
    ingredients: [
      { materialId: 'gin', amount: 60, unit: 'ml' },
      { materialId: 'missing', amount: 1, unit: 'drop' }
    ],
    glasswareId: 'coupe',
    toolIds: ['shaker', 'unknown', 'strainer']
  }
  const lookups = {
    materialsById: { gin: { id: 'gin', name: '金酒' } },
    glasswareById: { coupe: { id: 'coupe', name: '鸡尾酒杯' } },
    toolsById: {
      shaker: { id: 'shaker', name: '摇酒壶' },
      strainer: { id: 'strainer', name: '滤冰器' }
    }
  }
  const snapshot = structuredClone({ recipe, lookups })

  const summary = hydrateRecipeSummary(recipe, lookups)

  assert.deepEqual(summary, {
    id: 'martini',
    name: 'Martini',
    image: '/images/martini.png',
    preparations: [{ type: '即调' }],
    rating: '夸',
    ingredients: [
      {
        materialId: 'gin', amount: 60, unit: 'ml',
        material: { id: 'gin', name: '金酒' }
      },
      {
        materialId: 'missing', amount: 1, unit: 'drop', material: null
      }
    ],
    glasswareId: 'coupe',
    glassware: { id: 'coupe', name: '鸡尾酒杯' },
    toolIds: ['shaker', 'unknown', 'strainer'],
    tools: [
      { id: 'shaker', name: '摇酒壶' },
      { id: 'strainer', name: '滤冰器' }
    ]
  })
  assert.notStrictEqual(summary, recipe)
  assert.notStrictEqual(summary.ingredients[0], recipe.ingredients[0])
  assert.deepEqual({ recipe, lookups }, snapshot)
})

test('hydrates a stable empty relationship shape from missing data', () => {
  assert.deepEqual(hydrateRecipeSummary(), {
    id: undefined,
    name: undefined,
    image: undefined,
    preparations: undefined,
    rating: undefined,
    ingredients: [],
    glasswareId: undefined,
    glassware: null,
    toolIds: [],
    tools: []
  })
})

test('aggregates recipe material observations newest first with stable fallbacks', () => {
  const recipes = [
    {
      id: 'first',
      name: '第一杯',
      materialObservations: [
        {
          materialId: 'gin',
          note: '较旧记录',
          createdAt: '2026-07-01T10:00:00.000Z'
        },
        {
          materialId: 'gin',
          note: '无效日期先出现',
          createdAt: 'not-a-date'
        },
        { materialId: 'gin', note: '   ', createdAt: '2026-08-01' },
        { materialId: 'rum', note: '别的材料', createdAt: '2026-09-01' }
      ]
    },
    {
      id: 'second',
      name: '第二杯',
      preferenceNote: '不应作为替代数据源',
      materialObservations: [
        {
          materialId: 'gin',
          note: '最新记录',
          createdAt: '2026-07-20T10:00:00.000Z'
        },
        {
          materialId: 'gin',
          note: '同时间第二条',
          createdAt: '2026-07-01T10:00:00.000Z'
        },
        { materialId: 'gin', note: '缺失日期' },
        { materialId: 'gin', note: 42, createdAt: '2026-10-01' }
      ]
    },
    null
  ]
  const snapshot = structuredClone(recipes)

  assert.deepEqual(getMaterialPreferenceNotes('gin', recipes), [
    {
      recipeId: 'second', recipeName: '第二杯', note: '最新记录',
      createdAt: '2026-07-20T10:00:00.000Z'
    },
    {
      recipeId: 'first', recipeName: '第一杯', note: '较旧记录',
      createdAt: '2026-07-01T10:00:00.000Z'
    },
    {
      recipeId: 'second', recipeName: '第二杯', note: '同时间第二条',
      createdAt: '2026-07-01T10:00:00.000Z'
    },
    {
      recipeId: 'first', recipeName: '第一杯', note: '无效日期先出现',
      createdAt: 'not-a-date'
    },
    {
      recipeId: 'second', recipeName: '第二杯', note: '缺失日期',
      createdAt: undefined
    }
  ])
  assert.deepEqual(recipes, snapshot)
})

test('returns no preference notes for missing or malformed collections', () => {
  assert.deepEqual(getMaterialPreferenceNotes('gin'), [])
  assert.deepEqual(getMaterialPreferenceNotes('gin', [
    {},
    { materialObservations: null },
    { materialObservations: ['note', null] }
  ]), [])
})
