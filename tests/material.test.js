const assert = require('node:assert/strict')
const test = require('node:test')

const {
  PREP_TYPES,
  PREP_ENTRY_TYPES,
  QUICK_BASE_SPIRITS,
  QUICK_TOOLS,
  RATINGS,
  UNITS,
  RECIPE_UNITS
} = require('../miniprogram/domain/constants')
const {
  createMaterialDefaults,
  getMaterialIdentityKey,
  getMaterialVisualState,
  MATERIAL_CATEGORY_GROUPS,
  getMaterialCategoryGroup,
  selectMaterialCategory
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
    '其他预调'
  ])
  assert.deepEqual(PREP_ENTRY_TYPES, [
    '即调',
    '冷冻',
    '冷泡/浸泡',
    '奶洗',
    '低温慢煮'
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
  assert.deepEqual(RECIPE_UNITS, [
    { value: 'ml', label: 'ml' },
    { value: 'g', label: 'g' },
    { value: 'piece', label: '个' },
    { value: 'top-up', label: '补满' },
    { value: 'to-taste', label: '适量' },
    { value: 'chunk', label: '块' },
    { value: 'drop', label: '滴' }
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
    defaultUnit: 'ml',
    trackFreshness: false,
    assumedAvailable: false,
    owned: true,
    freshOnHand: false
  })
})

test('plain rum is a base-spirit alias for white rum without collapsing specific rum styles', () => {
  assert.equal(createMaterialDefaults('base-spirit', ' 朗姆 ').name, '白朗姆')
  assert.equal(getMaterialIdentityKey('base-spirit', '朗姆'), getMaterialIdentityKey('base-spirit', '白朗姆'))
  assert.notEqual(getMaterialIdentityKey('base-spirit', '黑朗姆'), getMaterialIdentityKey('base-spirit', '白朗姆'))
  assert.notEqual(getMaterialIdentityKey('other-base-spirit', '朗姆'), getMaterialIdentityKey('base-spirit', '白朗姆'))
})

test('plain and single syrup names share the ordinary syrup identity without collapsing flavored syrups', () => {
  assert.equal(createMaterialDefaults('syrup/staple', '糖浆').name, '普通糖浆')
  assert.equal(createMaterialDefaults('syrup/staple', '单糖浆').name, '普通糖浆')
  assert.equal(getMaterialIdentityKey('syrup/staple', '糖浆'), getMaterialIdentityKey('syrup/staple', '普通糖浆'))
  assert.equal(getMaterialIdentityKey('syrup/staple', '单糖浆'), getMaterialIdentityKey('syrup/staple', '普通糖浆'))
  assert.notEqual(getMaterialIdentityKey('syrup/staple', '蜂蜜糖浆'), getMaterialIdentityKey('syrup/staple', '普通糖浆'))
})

test('fruit defaults to an unprepared freshness-tracked solid', () => {
  const fruit = createMaterialDefaults('fruit', '西瓜')

  assert.equal(fruit.acquisition, 'on-demand')
  assert.equal(fruit.form, 'solid')
  assert.equal(fruit.defaultUnit, 'ml')
  assert.equal(fruit.trackFreshness, true)
  assert.equal(fruit.freshOnHand, false)
})

test('spice creation defaults to a long-term solid material', () => {
  const spiceGroup = MATERIAL_CATEGORY_GROUPS.find(({ key }) => key === 'spice')
  const spice = createMaterialDefaults(spiceGroup.category, '肉桂')

  assert.equal(spice.category, 'other-solid')
  assert.equal(spice.acquisition, 'long-term')
  assert.equal(spice.form, 'solid')
  assert.equal(spice.defaultUnit, 'g')
  assert.equal(spice.owned, false)
  assert.equal(spice.freshOnHand, false)
})

test('tonic defaults to an unprepared on-demand top-up liquid', () => {
  const tonic = createMaterialDefaults('tonic', '汤力水')

  assert.equal(tonic.acquisition, 'on-demand')
  assert.equal(tonic.form, 'liquid')
  assert.equal(tonic.defaultUnit, 'top-up')
  assert.equal(tonic.freshOnHand, false)
  assert.equal(tonic.category, 'soda/tonic')
})

test('all plan material categories have stable defaults', () => {
  const expectations = {
    'other-base-spirit': {
      acquisition: 'long-term', form: 'liquid', alcoholic: true, abv: null,
      defaultUnit: 'ml', trackFreshness: false, assumedAvailable: false,
      owned: false, freshOnHand: false
    },
    liqueur: {
      acquisition: 'long-term', form: 'liquid', alcoholic: true, abv: null,
      defaultUnit: 'ml', trackFreshness: false, assumedAvailable: false,
      owned: false, freshOnHand: false
    },
    bitters: {
      acquisition: 'long-term', form: 'liquid', alcoholic: true, abv: null,
      defaultUnit: 'drop', trackFreshness: false, assumedAvailable: false,
      owned: false, freshOnHand: false
    },
    citrus: {
      acquisition: 'long-term', form: 'liquid', alcoholic: false, abv: null,
      defaultUnit: 'ml', trackFreshness: false, assumedAvailable: true,
      owned: true, freshOnHand: false
    },
    'syrup/staple': {
      acquisition: 'long-term', form: 'liquid', alcoholic: false, abv: null,
      defaultUnit: 'ml', trackFreshness: false, assumedAvailable: true,
      owned: true, freshOnHand: false
    },
    'dairy/juice': {
      acquisition: 'on-demand', form: 'liquid', alcoholic: false, abv: null,
      defaultUnit: 'ml', trackFreshness: true, assumedAvailable: false,
      owned: false, freshOnHand: false
    },
    'soda/tonic': {
      acquisition: 'on-demand', form: 'liquid', alcoholic: false, abv: null,
      defaultUnit: 'top-up', trackFreshness: false, assumedAvailable: false,
      owned: false, freshOnHand: false
    },
    'other-liquid': {
      acquisition: 'on-demand', form: 'liquid', alcoholic: false, abv: null,
      defaultUnit: 'ml', trackFreshness: false, assumedAvailable: false,
      owned: false, freshOnHand: false
    },
    'other-solid': {
      acquisition: 'long-term', form: 'solid', alcoholic: false, abv: null,
      defaultUnit: 'g', trackFreshness: false, assumedAvailable: false,
      owned: false, freshOnHand: false
    },
    other: {
      acquisition: 'on-demand', form: 'liquid', alcoholic: false, abv: null,
      defaultUnit: 'ml', trackFreshness: false, assumedAvailable: false,
      owned: false, freshOnHand: false
    }
  }

  for (const [category, defaults] of Object.entries(expectations)) {
    assert.deepEqual(
      createMaterialDefaults(category, category),
      { category, name: category, ...defaults },
      category
    )
  }
})

test('normalizes material category aliases for persisted defaults', () => {
  const aliases = {
    tonic: 'soda/tonic',
    soda: 'soda/tonic',
    dairy: 'dairy/juice',
    juice: 'dairy/juice',
    syrup: 'syrup/staple',
    staple: 'syrup/staple'
  }

  for (const [alias, canonicalCategory] of Object.entries(aliases)) {
    assert.equal(
      createMaterialDefaults(alias, alias).category,
      canonicalCategory,
      alias
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

test('user-facing material categories are shared while legacy detail categories remain stable', () => {
  assert.deepEqual(MATERIAL_CATEGORY_GROUPS.map(({ key, label }) => ({ key, label })), [
    { key: 'base', label: '基酒' },
    { key: 'liqueur', label: '利口酒' },
    { key: 'syrup', label: '糖浆' },
    { key: 'produce', label: '果汁/果蔬' },
    { key: 'mixer', label: '混合饮品' },
    { key: 'spice', label: '香料' },
    { key: 'other', label: '其他' }
  ])
  assert.equal(getMaterialCategoryGroup('dairy/juice').key, 'produce')
  assert.equal(getMaterialCategoryGroup('other').key, 'other')
  assert.equal(selectMaterialCategory('dairy/juice', 'produce'), 'dairy/juice')
  assert.equal(selectMaterialCategory('dairy/juice', 'mixer'), 'other-liquid')
})
