const assert = require('node:assert/strict')
const test = require('node:test')

const {
  PREP_TYPES,
  QUICK_BASE_SPIRITS,
  QUICK_TOOLS,
  RATINGS,
  UNITS
} = require('../miniprogram/domain/constants')
const {
  createMaterialDefaults,
  getMaterialVisualState
} = require('../miniprogram/domain/material')

test('exports the approved quick base spirits in display order', () => {
  assert.deepEqual(QUICK_BASE_SPIRITS.map((spirit) => spirit.id), [
    'gin',
    'white-rum',
    'whiskey',
    'vodka',
    'tequila'
  ])
  assert.deepEqual(QUICK_BASE_SPIRITS.map((spirit) => spirit.name), [
    '金酒',
    '白朗姆',
    '威士忌',
    '伏特加',
    '龙舌兰'
  ])
  assert.ok(QUICK_BASE_SPIRITS.every((spirit) => spirit.abv === 40))
})

test('exports the approved preparation types and ratings in display order', () => {
  assert.deepEqual(PREP_TYPES, [
    '即调',
    '冷冻',
    '冷泡/浸泡',
    '奶洗',
    '低温慢煮',
    '其他预制'
  ])
  assert.deepEqual(RATINGS, ['夯', '顶尖', '人上人', 'NPC', '拉完了'])
})

test('exports the eleven approved quick tools', () => {
  assert.deepEqual(QUICK_TOOLS, [
    '摇酒壶',
    '量酒器',
    '滤冰器',
    '细滤网',
    '吧勺',
    '捣棒',
    '搅拌杯',
    '榨汁器',
    '搅拌机',
    '低温慢煮设备',
    '过滤容器'
  ])
})

test('exports stable values and Chinese labels for all supported units', () => {
  assert.deepEqual(UNITS, [
    { value: 'ml', label: 'ml' },
    { value: 'g', label: 'g' },
    { value: 'piece', label: '个' },
    { value: 'slice', label: '片' },
    { value: 'drop', label: '滴' },
    { value: 'chunk', label: '块' },
    { value: 'top-up', label: '补满' },
    { value: 'to-taste', label: '适量' }
  ])
})

test('quick base spirits default to owned 40 percent liquids', () => {
  assert.deepEqual(createMaterialDefaults('base-spirit', '金酒'), {
    category: 'base-spirit',
    name: '金酒',
    acquisition: 'long-term',
    form: 'liquid',
    alcoholic: true,
    abv: 40,
    unit: 'ml',
    trackFreshness: false,
    assumedAvailable: false,
    owned: true,
    freshOnHand: false
  })
})

test('fruit defaults to an unprepared freshness-tracked solid', () => {
  const fruit = createMaterialDefaults('fruit', '西瓜')

  assert.equal(fruit.acquisition, 'on-demand')
  assert.equal(fruit.form, 'solid')
  assert.equal(fruit.unit, 'ml')
  assert.equal(fruit.trackFreshness, true)
  assert.equal(fruit.freshOnHand, false)
})

test('tonic defaults to an unprepared on-demand top-up liquid', () => {
  const tonic = createMaterialDefaults('tonic', '汤力水')

  assert.equal(tonic.acquisition, 'on-demand')
  assert.equal(tonic.form, 'liquid')
  assert.equal(tonic.unit, 'top-up')
  assert.equal(tonic.freshOnHand, false)
})

test('all plan material categories have stable defaults', () => {
  const expectations = {
    'other-base-spirit': ['long-term', 'liquid', 'ml'],
    liqueur: ['long-term', 'liquid', 'ml'],
    bitters: ['long-term', 'liquid', 'drop'],
    citrus: ['long-term', 'liquid', 'ml'],
    'syrup/staple': ['long-term', 'liquid', 'ml'],
    'dairy/juice': ['on-demand', 'liquid', 'ml'],
    'soda/tonic': ['on-demand', 'liquid', 'top-up'],
    'other-liquid': ['on-demand', 'liquid', 'ml'],
    'other-solid': ['on-demand', 'solid', 'g']
  }

  for (const [category, [acquisition, form, unit]] of Object.entries(expectations)) {
    const material = createMaterialDefaults(category, category)
    assert.deepEqual(
      [material.acquisition, material.form, material.unit],
      [acquisition, form, unit],
      category
    )
  }
})

test('untracked citrus and syrup staples are assumed available', () => {
  for (const [category, name] of [
    ['citrus', '柠檬汁'],
    ['citrus', '青柠汁'],
    ['syrup/staple', '糖浆']
  ]) {
    const material = createMaterialDefaults(category, name)
    assert.equal(material.trackFreshness, false)
    assert.equal(material.assumedAvailable, true)
    assert.equal(getMaterialVisualState(material), 'owned')
    assert.notEqual(
      getMaterialVisualState({ ...material, trackFreshness: true, owned: false }),
      'owned'
    )
  }
})

test('returns the three material visual states from availability semantics', () => {
  assert.equal(
    getMaterialVisualState({ acquisition: 'long-term', owned: true }),
    'owned'
  )
  assert.equal(
    getMaterialVisualState({ acquisition: 'long-term', owned: false }),
    'missing-long-term'
  )
  assert.equal(
    getMaterialVisualState({ acquisition: 'on-demand', freshOnHand: false }),
    'quick-buy'
  )
  assert.equal(
    getMaterialVisualState({ acquisition: 'on-demand', freshOnHand: true }),
    'owned'
  )
  assert.equal(
    getMaterialVisualState({
      acquisition: 'long-term',
      owned: false,
      trackFreshness: false,
      assumedAvailable: true
    }),
    'owned'
  )
})
