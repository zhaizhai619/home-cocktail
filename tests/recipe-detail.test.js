const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { RATINGS } = require('../miniprogram/domain/constants')
const {
  buildRecipeDetail,
  decodeRecipeId,
  formatDate,
  validateObservation,
  orchestrateObservationSave,
  orchestrateObservationDelete,
  orchestrateRatingToggle,
  validateManualAbv,
  orchestrateManualAbvSave,
  orchestrateRecipeCopy,
  orchestrateRecipeDelete
} = require('../miniprogram/pages/recipe-detail/model')
const { createRepository } = require('../miniprogram/services/repository')
const { STORAGE_KEY } = require('../miniprogram/services/schema')

function createMemoryAdapter() {
  const values = new Map()
  return {
    get(key) { return values.get(key) },
    set(key, value) { values.set(key, value) },
    read(key) { return structuredClone(values.get(key)) }
  }
}

function createFaultAdapter() {
  const values = new Map()
  let shouldFail = false
  return {
    get(key) { return values.get(key) },
    set(key, value) {
      if (shouldFail) { shouldFail = false; throw new Error('storage unavailable') }
      values.set(key, structuredClone(value))
    },
    failNextWrite() { shouldFail = true },
    read(key) { return structuredClone(values.get(key)) }
  }
}

function createDetailFixture() {
  const recipe = {
    id: 'summer', name: '西瓜夏日杯', imagePath: '/images/summer.jpg', source: '自己的配方', tried: true,
    ingredients: [
      { materialId: 'gin', amount: 40, unit: 'ml' },
      { materialId: 'watermelon', amount: 100, unit: 'ml' },
      { materialId: 'liqueur', amount: 10, unit: 'ml' },
      { materialId: 'tonic', amount: null, unit: 'top-up' }
    ],
    preparations: [
      { type: '冷冻', amount: 1, unit: 'day', note: '西瓜提前冻硬' },
      { type: '冷泡/浸泡', amount: 8, unit: 'hour', note: '冷泡茶叶' }
    ],
    glasswareId: 'highball', toolIds: ['shaker', 'strainer'],
    steps: ['摇和除汤力水外的材料', '滤入杯中并补满汤力水'],
    rating: '顶尖', tastingNote: '清爽，西瓜味很自然',
    materialObservations: [
      { materialId: 'watermelon', note: '无籽西瓜更省事', createdAt: '2026-07-19T12:00:00.000Z' }
    ]
  }
  const materials = [
    { id: 'gin', name: '金酒', acquisition: 'long-term', owned: true, alcoholic: true, abv: 40 },
    { id: 'watermelon', name: '西瓜', acquisition: 'on-demand', freshOnHand: false, alcoholic: false },
    { id: 'liqueur', name: '接骨木花利口酒', acquisition: 'long-term', owned: false, alcoholic: true, abv: 20 },
    { id: 'tonic', name: '汤力水', acquisition: 'on-demand', freshOnHand: true, alcoholic: false }
  ]
  return {
    recipe,
    materials,
    glassware: [{ id: 'highball', name: '海波杯', capacity: 300 }],
    tools: [{ id: 'shaker', name: '摇酒壶' }, { id: 'strainer', name: '滤冰器' }]
  }
}

test('buildRecipeDetail returns an explicit missing state for an absent recipe', () => {
  assert.deepEqual(buildRecipeDetail(null), {
    status: 'missing',
    message: '没有找到这款酒，它可能已被删除'
  })
})

test('recipe detail renders multiple prepared outputs as normal serving rows without suffix copy', () => {
  const detail = buildRecipeDetail({
    id: 'prepared', name: '双预制嗨棒', ingredients: [
      { kind: 'prepared-output', preparationId: 'prep-rum', amount: 40, unit: 'ml' },
      { kind: 'prepared-output', preparationId: 'prep-juice', amount: 20, unit: 'ml' },
      { materialId: 'soda', amount: null, unit: 'top-up' }
    ],
    advancePreparations: [
      { id: 'prep-rum', outputName: '菠萝朗姆', ingredients: [{ materialId: 'rum', amount: 500, unit: 'ml' }], steps: ['浸泡后过滤'] },
      { id: 'prep-juice', outputName: '澄清果汁', ingredients: [{ materialId: 'juice', amount: 300, unit: 'ml' }], steps: ['澄清后冷藏'] }
    ]
  }, [
    { id: 'soda', name: '苏打水', alcoholic: false, acquisition: 'long-term', owned: true },
    { id: 'rum', name: '白朗姆', alcoholic: true, abv: 40, acquisition: 'long-term', owned: true },
    { id: 'juice', name: '苹果汁', alcoholic: false, acquisition: 'on-demand', freshOnHand: true }
  ])
  assert.deepEqual(detail.ingredients.slice(0, 2).map(({ name, amountLabel }) => ({ name, amountLabel })), [
    { name: '菠萝朗姆', amountLabel: '40ml' }, { name: '澄清果汁', amountLabel: '20ml' }
  ])
  assert.deepEqual(detail.ingredients[0].preparation, {
    id: 'prep-rum',
    ingredients: [{
      materialId: 'rum',
      name: '白朗姆',
      amount: 500,
      unit: 'ml',
      amountLabel: '500ml',
      state: 'owned',
      accessibilityLabel: '白朗姆，材料已在手头，500ml',
      orphaned: false
    }],
    steps: ['浸泡后过滤'],
    hasSteps: true
  })
  assert.equal(detail.ingredients[1].preparation.hasSteps, true)
  assert.equal(detail.ingredients[2].preparation, undefined)
  assert.equal(detail.advancePreparations[0].ingredients[0].name, '白朗姆')
  assert.equal(detail.advancePreparations[1].ingredients[0].name, '苹果汁')
  assert.equal(detail.abv.valueLabel, '--')
  assert.equal(detail.abv.issueLines[0].text, '含本配方预调成品，暂不计算酒精度')
  assert.equal(detail.abvBadgeLabel, '编辑酒精度')
})

test('recipe detail applies the default prepared, spirit, then other ingredient order', () => {
  const recipe = {
    id: 'default-order',
    name: '默认顺序',
    ingredients: [
      { materialId: 'lemon', amount: 20, unit: 'ml' },
      { materialId: 'liqueur', amount: 15, unit: 'ml' },
      { kind: 'prepared-output', preparationId: 'prep-juice', amount: 40, unit: 'ml' },
      { materialId: 'gin', amount: 30, unit: 'ml' }
    ],
    advancePreparations: [{
      id: 'prep-juice',
      outputName: '混合果汁',
      ingredients: [{ materialId: 'cucumber', amount: 30, unit: 'g' }],
      steps: []
    }]
  }
  const materials = [
    { id: 'lemon', name: '柠檬汁', category: 'citrus', acquisition: 'long-term', owned: true },
    { id: 'liqueur', name: '君度', category: 'liqueur', acquisition: 'long-term', owned: true, alcoholic: true, abv: 40 },
    { id: 'gin', name: '金酒', category: 'base-spirit', acquisition: 'long-term', owned: true, alcoholic: true, abv: 40 },
    { id: 'cucumber', name: '黄瓜', category: 'fruit', acquisition: 'on-demand', freshOnHand: true }
  ]

  assert.deepEqual(buildRecipeDetail(recipe, materials).ingredients.map(({ name }) => name), ['混合果汁', '君度', '金酒', '柠檬汁'])
})

test('recipe detail preserves an explicitly customized ingredient order', () => {
  const recipe = {
    id: 'custom-order',
    name: '自定义顺序',
    ingredientOrderCustomized: true,
    ingredients: [
      { materialId: 'lemon', amount: 20, unit: 'ml' },
      { materialId: 'gin', amount: 30, unit: 'ml' },
      { kind: 'prepared-output', preparationId: 'prep-juice', amount: 40, unit: 'ml' }
    ],
    advancePreparations: [{ id: 'prep-juice', outputName: '混合果汁', ingredients: [], steps: [] }]
  }
  const materials = [
    { id: 'lemon', name: '柠檬汁', category: 'citrus', acquisition: 'long-term', owned: true },
    { id: 'gin', name: '金酒', category: 'base-spirit', acquisition: 'long-term', owned: true, alcoholic: true, abv: 40 }
  ]

  assert.deepEqual(buildRecipeDetail(recipe, materials).ingredients.map(({ name }) => name), ['柠檬汁', '金酒', '混合果汁'])
})

test('recipe detail marks an empty advance preparation as having no collapsible steps', () => {
  const detail = buildRecipeDetail({
    id: 'no-steps',
    name: '无步骤预调',
    ingredients: [{ kind: 'prepared-output', preparationId: 'prep-tea', amount: 60, unit: 'ml' }],
    advancePreparations: [{
      id: 'prep-tea',
      outputName: '冷泡茶',
      ingredients: [{ materialId: 'tea', amount: 9, unit: 'g' }],
      steps: ['', '   ']
    }]
  }, [{ id: 'tea', name: '红茶', acquisition: 'long-term', owned: true, alcoholic: false }])

  assert.deepEqual(detail.ingredients[0].preparation.steps, [])
  assert.equal(detail.ingredients[0].preparation.hasSteps, false)
})

test('recipe detail manual ABV overrides calculation and can be saved or cleared', () => {
  const fixture = createDetailFixture()
  const manual = buildRecipeDetail({ ...fixture.recipe, manualAbv: 12.5 }, fixture.materials, fixture.glassware, fixture.tools)
  assert.equal(manual.abvBadgeLabel, '12.5%')
  assert.equal(buildRecipeDetail(fixture.recipe, fixture.materials, fixture.glassware, fixture.tools).abvBadgeLabel, '7.2%')
  assert.deepEqual(validateManualAbv(' 18.6 '), { valid: true, value: 18.6, message: '' })
  assert.deepEqual(validateManualAbv(''), { valid: true, value: null, message: '' })
  assert.equal(validateManualAbv('101').valid, false)

  const repository = createRepository(createMemoryAdapter(), { idFactory: () => 'manual-recipe', now: () => '2026-07-23T00:00:00.000Z' })
  repository.initialize()
  const recipe = repository.upsertRecipe({ name: '手动酒精度', ingredients: [] })
  assert.equal(orchestrateManualAbvSave({ repository, recipe, value: '18.6' }).recipe.manualAbv, 18.6)
  assert.equal(orchestrateManualAbvSave({ repository, recipe: repository.getRecipe(recipe.id), value: '' }).recipe.manualAbv, null)
})

test('recipe detail uses the short syrup name for ingredients, observations and ingredient options', () => {
  const detail = buildRecipeDetail({
    id: 'simple-syrup', name: '糖浆测试', ingredients: [{ materialId: 'ordinary', amount: 15, unit: 'ml' }],
    materialObservations: [{ materialId: 'ordinary', note: '减量', createdAt: '2026-07-20T00:00:00.000Z' }]
  }, [{ id: 'ordinary', name: '普通糖浆', category: 'syrup/staple', acquisition: 'long-term', owned: true, alcoholic: false }])

  assert.equal(detail.ingredients[0].name, '糖浆')
  assert.equal(detail.ingredients[0].accessibilityLabel, '糖浆，材料已在手头，15ml')
  assert.equal(detail.observations[0].materialName, '糖浆')
  assert.deepEqual(detail.ingredientOptions, [{ id: 'ordinary', name: '糖浆' }])
})

test('recipe detail renders a text ingredient amount with its unit', () => {
  const detail = buildRecipeDetail({
    id: 'cucumber', name: '黄瓜酒', ingredients: [{ materialId: 'cucumber', amount: '半', unit: 'piece' }]
  }, [{ id: 'cucumber', name: '黄瓜', category: 'fruit', acquisition: 'on-demand', freshOnHand: true, alcoholic: false }])

  assert.equal(detail.ingredients[0].amountLabel, '半个')
})

test('recipe detail uses the short syrup name in calculation warnings', () => {
  const detail = buildRecipeDetail({
    id: 'missing-syrup-amount', name: '待补用量', ingredients: [
      { materialId: 'ordinary', amount: null, unit: 'ml' },
      { materialId: 'same-name-other-category', amount: null, unit: 'ml' }
    ]
  }, [
    { id: 'ordinary', name: '普通糖浆', category: 'syrup/staple', acquisition: 'long-term', owned: true, alcoholic: false },
    { id: 'same-name-other-category', name: '普通糖浆', category: 'other-liquid', acquisition: 'long-term', owned: true, alcoholic: false }
  ])

  assert.deepEqual(detail.abv.missing, ['糖浆', '普通糖浆', '没有可计算的液体材料'])
  assert.deepEqual(detail.abv.issueLines, [{ kind: 'amount', text: '缺少可计算用量：糖浆、普通糖浆、没有可计算的液体材料' }])
})

test('buildRecipeDetail composes complete display data without mutating its inputs', () => {
  const fixture = createDetailFixture()
  const snapshot = structuredClone(fixture)
  const detail = buildRecipeDetail(fixture.recipe, fixture.materials, fixture.glassware, fixture.tools)

  assert.equal(detail.status, 'ok')
  assert.equal(detail.name, '西瓜夏日杯')
  assert.equal(detail.imagePath, '/images/summer.jpg')
  assert.deepEqual(detail.preparations.map(({ label, note }) => ({ label, note })), [
    { label: '冷冻 · 提前1天', note: '西瓜提前冻硬' },
    { label: '冷泡/浸泡 · 提前8小时', note: '冷泡茶叶' }
  ])
  assert.deepEqual(detail.ingredients.map(({ name, amountLabel, state, accessibilityLabel, stateLabel }) => ({ name, amountLabel, state, accessibilityLabel, stateLabel })), [
    { name: '金酒', amountLabel: '40ml', state: 'owned', accessibilityLabel: '金酒，材料已在手头，40ml', stateLabel: undefined },
    { name: '西瓜', amountLabel: '100ml', state: 'quick-buy', accessibilityLabel: '西瓜，材料可随买随用，100ml', stateLabel: undefined },
    { name: '接骨木花利口酒', amountLabel: '10ml', state: 'missing-long-term', accessibilityLabel: '接骨木花利口酒，材料暂时没有，10ml', stateLabel: undefined },
    { name: '汤力水', amountLabel: '补满', state: 'owned', accessibilityLabel: '汤力水，材料已在手头，补满', stateLabel: undefined }
  ])
  assert.deepEqual(detail.abv, { status: 'ok', valueLabel: '7.2%', liquidVolumeLabel: '250ml', missing: [], ignored: [], issueLines: [], ignoredText: '', needsEditing: false })
  assert.deepEqual(detail.glassware, { id: 'highball', name: '海波杯', capacityLabel: '300ml' })
  assert.deepEqual(detail.tools.map(({ name }) => name), ['摇酒壶', '滤冰器'])
  assert.deepEqual(detail.steps, ['摇和除汤力水外的材料', '滤入杯中并补满汤力水', '清爽，西瓜味很自然'])
  assert.deepEqual(detail.ratings, RATINGS.map((label) => ({ label, selected: label === '顶尖' })))
  assert.deepEqual(detail.observations, [{
    materialId: 'watermelon',
    materialName: '西瓜',
    note: '无籽西瓜更省事',
    createdAtLabel: '2026-07-19',
    observationIndex: 0,
    renderKey: 'recipe:summer:0'
  }])
  assert.deepEqual(fixture, snapshot)
})

test('recipe detail merges a legacy tasting note into steps without duplicating the same text', () => {
  const legacyOnly = buildRecipeDetail({ id: 'legacy-note', name: '旧配方', steps: [], tastingNote: '少放糖更好喝' })
  assert.deepEqual(legacyOnly.steps, ['少放糖更好喝'])

  const duplicate = buildRecipeDetail({ id: 'duplicate-note', name: '重复文本', steps: ['少放糖更好喝'], tastingNote: ' 少放糖更好喝 ' })
  assert.deepEqual(duplicate.steps, ['少放糖更好喝'])
})

test('recipe detail displays arbitrary preparation duration text without duplicating 提前', () => {
  const detail = buildRecipeDetail({
    id: 'free-duration', name: '自由时间',
    preparations: [
      { type: '奶洗', durationText: '隔夜' },
      { type: '其他预调', durationText: '提前一周' }
    ]
  })

  assert.deepEqual(detail.preparations.map(({ label }) => label), ['奶洗 · 提前隔夜', '其他预调 · 提前一周'])
})

test('buildRecipeDetail counts orphan ml amounts but blocks ABV with distinct material and ABV reasons', () => {
  const detail = buildRecipeDetail({
    id: 'broken', name: '待补资料',
    ingredients: [{ materialId: 'unknown', amount: 20, unit: 'ml' }, { materialId: 'amaro', amount: 20, unit: 'ml' }]
  }, [{ id: 'amaro', name: '阿玛罗', acquisition: 'long-term', owned: true, alcoholic: true, abv: null }])

  assert.equal(detail.ingredients[0].orphaned, true)
  assert.equal(detail.ingredients[0].name, '缺失材料（unknown）')
  assert.equal(detail.ingredients[0].amount, 20)
  assert.equal(detail.ingredients[0].unit, 'ml')
  assert.equal(detail.ingredients[0].amountLabel, '20ml')
  assert.deepEqual(detail.abv, {
    status: 'missing', valueLabel: '--', liquidVolumeLabel: '40ml',
    missing: ['缺失材料（unknown）', '阿玛罗'], ignored: [],
    issueLines: [
      { kind: 'material', text: '材料资料缺失：缺失材料（unknown）' },
      { kind: 'abv', text: '缺少酒精度：阿玛罗' }
    ],
    ignoredText: '', needsEditing: true
  })
})

test('buildRecipeDetail exposes the sole missing ABV material as the direct edit target', () => {
  const detail = buildRecipeDetail({
    id: 'missing-abv', name: '待补度数', ingredients: [{ materialId: 'amaro', amount: 20, unit: 'ml' }]
  }, [{ id: 'amaro', name: '阿玛罗', acquisition: 'long-term', owned: true, alcoholic: true, abv: null }])

  assert.equal(detail.abv.editMaterialId, 'amaro')
})

test('buildRecipeDetail distinguishes missing calculable amounts from ignored non-ml garnishes', () => {
  const detail = buildRecipeDetail({
    id: 'reasons', name: '待补计算信息', ingredients: [
      { materialId: 'liqueur', amount: 10, unit: 'ml' },
      { materialId: 'juice', amount: null, unit: 'ml' },
      { materialId: 'peel', amount: 1, unit: 'slice' },
      { materialId: 'bitters', amount: 2, unit: 'drop' }
    ]
  }, [
    { id: 'liqueur', name: '紫罗兰利口酒', acquisition: 'long-term', owned: true, alcoholic: true, abv: 120 },
    { id: 'juice', name: '苹果汁', acquisition: 'on-demand', freshOnHand: true, alcoholic: false },
    { id: 'peel', name: '柠檬皮', acquisition: 'on-demand', freshOnHand: true, alcoholic: false },
    { id: 'bitters', name: '苦精', acquisition: 'long-term', owned: true, alcoholic: true, abv: 45 }
  ])

  assert.deepEqual(detail.abv, {
    status: 'missing', valueLabel: '--', liquidVolumeLabel: '--', knownLiquidVolumeText: '已知液体至少 10ml', volumeComplete: false,
    missing: ['紫罗兰利口酒', '苹果汁', '苦精'], ignored: ['柠檬皮'],
    issueLines: [
      { kind: 'abv', text: '缺少酒精度：紫罗兰利口酒' },
      { kind: 'amount', text: '缺少可计算用量：苹果汁、苦精' }
    ],
    ignoredText: '未计入非 ml 材料：柠檬皮', needsEditing: true
  })
  assert.deepEqual(detail.capacity, {
    status: 'incomplete', liquidVolume: 10, capacityMl: null, differenceMl: null,
    message: '总体积信息不完整（已知液体至少 10ml）', ignored: ['柠檬皮']
  })
})

test('buildRecipeDetail treats every invalid legacy alcoholic ABV as missing', () => {
  for (const abv of [0, -1, 101, 'not-a-number']) {
    const detail = buildRecipeDetail({
      id: `legacy-${abv}`, name: '旧数据', ingredients: [{ materialId: 'legacy-spirit', amount: 20, unit: 'ml' }]
    }, [{ id: 'legacy-spirit', name: '旧酒款', acquisition: 'long-term', owned: true, alcoholic: true, abv }])

    assert.equal(detail.abv.status, 'missing', `abv=${abv}`)
    assert.equal(detail.abv.valueLabel, '--', `abv=${abv}`)
    assert.deepEqual(detail.abv.missing, ['旧酒款'], `abv=${abv}`)
    assert.deepEqual(detail.abv.issueLines, [{ kind: 'abv', text: '缺少酒精度：旧酒款' }], `abv=${abv}`)
  }
})

test('buildRecipeDetail treats prototype-like material ids as orphaned', () => {
  const detail = buildRecipeDetail({
    id: 'legacy-orphan', name: '旧数据', preparations: [{ type: '即调' }],
    ingredients: [{ materialId: 'constructor', amount: 30, unit: 'ml' }]
  }, [])

  assert.equal(detail.abv.valueLabel, '--')
  assert.deepEqual(detail.abv.issueLines, [{ kind: 'material', text: '材料资料缺失：缺失材料（constructor）' }])
  assert.equal(detail.ingredients[0].orphaned, true)
})

test('buildRecipeDetail accepts a real material whose id is __proto__', () => {
  const detail = buildRecipeDetail({
    id: 'safe-prototype-id', name: '原型键配方', preparations: [{ type: '即调' }],
    ingredients: [{ materialId: '__proto__', amount: 30, unit: 'ml' }]
  }, [{ id: '__proto__', name: '金酒', alcoholic: true, abv: 40 }])

  assert.equal(detail.abv.valueLabel, '40%')
  assert.equal(detail.ingredients[0].name, '金酒')
  assert.equal(detail.ingredients[0].orphaned, false)
})

test('observation validation requires a recipe ingredient and non-empty text', () => {
  const recipe = createDetailFixture().recipe
  assert.deepEqual(validateObservation(recipe, '', '好喝'), { valid: false, message: '请选择要记录的材料' })
  assert.deepEqual(validateObservation(recipe, 'not-in-recipe', '好喝'), { valid: false, message: '只能记录这款酒配方中的材料' })
  assert.deepEqual(validateObservation(recipe, 'gin', '   '), { valid: false, message: '请填写本次材料观察' })
  assert.deepEqual(validateObservation(recipe, 'gin', '  更适合干型金酒  '), { valid: true, materialId: 'gin', note: '更适合干型金酒' })
})

test('repository appends timestamped observations without overwriting history', () => {
  const repository = createRepository(createMemoryAdapter(), {
    idFactory: () => 'recipe-1',
    now: (() => {
      const values = ['2026-07-19T12:00:00.000Z', '2026-07-20T12:30:00.000Z', '2026-07-20T12:30:00.000Z']
      let index = 0
      return () => values[Math.min(index++, values.length - 1)]
    })()
  })
  repository.initialize()
  const recipe = repository.upsertRecipe({
    name: '金酒杯', ingredients: [{ materialId: 'gin', amount: 45, unit: 'ml' }],
    materialObservations: [{ materialId: 'gin', note: '第一条', createdAt: '2026-07-18T00:00:00.000Z' }]
  })
  const saved = repository.appendRecipeObservation(recipe.id, { materialId: 'gin', note: '第二条' })

  assert.deepEqual(saved.materialObservations, [
    { materialId: 'gin', note: '第一条', createdAt: '2026-07-18T00:00:00.000Z' },
    { materialId: 'gin', note: '第二条', createdAt: '2026-07-20T12:30:00.000Z' }
  ])
})

test('repository deletes exactly one recipe observation by its source index', () => {
  const repository = createRepository(createMemoryAdapter(), {
    idFactory: () => 'recipe-1',
    now: () => '2026-07-20T12:30:00.000Z'
  })
  repository.initialize()
  const recipe = repository.upsertRecipe({
    name: '金酒杯',
    ingredients: [{ materialId: 'gin', amount: 45, unit: 'ml' }],
    materialObservations: [
      { materialId: 'gin', note: '保留第一条', createdAt: '2026-07-18T00:00:00.000Z' },
      { materialId: 'gin', note: '删除这一条', createdAt: '2026-07-19T00:00:00.000Z' },
      { materialId: 'gin', note: '保留最后一条', createdAt: '2026-07-20T00:00:00.000Z' }
    ]
  })

  const saved = repository.deleteRecipeObservation(recipe.id, 1)
  assert.deepEqual(saved.materialObservations.map(({ note }) => note), ['保留第一条', '保留最后一条'])
  assert.equal(repository.deleteRecipeObservation(recipe.id, 8), null)
  assert.deepEqual(repository.getRecipe(recipe.id).materialObservations.map(({ note }) => note), ['保留第一条', '保留最后一条'])
})

test('recipe observation, duplicate, and delete writes roll back memory and persistence on storage failure', () => {
  for (const operation of ['observation', 'duplicate', 'delete']) {
    const adapter = createFaultAdapter()
    let nextId = 0
    const repository = createRepository(adapter, {
      idFactory: () => `id-${++nextId}`,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    repository.initialize()
    const recipe = repository.upsertRecipe({ name: '原配方', ingredients: [{ materialId: 'gin', amount: 40, unit: 'ml' }] })
    const beforeState = repository.getState()
    const beforeStorage = adapter.read(STORAGE_KEY)
    adapter.failNextWrite()

    assert.throws(() => {
      if (operation === 'observation') repository.appendRecipeObservation(recipe.id, { materialId: 'gin', note: '新观察' })
      if (operation === 'duplicate') repository.duplicateRecipe(recipe.id)
      if (operation === 'delete') repository.deleteRecipe(recipe.id)
    }, /storage unavailable/, operation)
    assert.deepEqual(repository.getState(), beforeState, `${operation} in-memory state`)
    assert.deepEqual(adapter.read(STORAGE_KEY), beforeStorage, `${operation} persisted state`)
  }
})

test('observation save orchestration handles validation, success, and repository failures', () => {
  const recipe = createDetailFixture().recipe
  const calls = []; const messages = []
  const repository = { appendRecipeObservation(id, value) { calls.push({ id, value }); return { id } } }
  assert.equal(orchestrateObservationSave({ repository, recipe, materialId: '', note: 'x', notify: (value) => messages.push(value) }).saved, false)
  assert.deepEqual(messages, ['请选择要记录的材料'])
  assert.equal(orchestrateObservationSave({ repository, recipe, materialId: 'gin', note: ' 干爽 ', notify: (value) => messages.push(value) }).saved, true)
  assert.deepEqual(calls, [{ id: 'summer', value: { materialId: 'gin', note: '干爽' } }])
  assert.equal(orchestrateObservationSave({ repository: { appendRecipeObservation() { throw new Error('offline') } }, recipe, materialId: 'gin', note: 'x', notify: (value) => messages.push(value) }).saved, false)
  assert.equal(messages.at(-1), '保存失败，请重试')
})

test('observation delete orchestration reports success and storage failures', () => {
  const calls = []
  const messages = []
  const repository = {
    deleteRecipeObservation(recipeId, observationIndex) {
      calls.push({ recipeId, observationIndex })
      return { id: recipeId }
    }
  }

  assert.equal(orchestrateObservationDelete({
    repository,
    recipeId: 'summer',
    observationIndex: 2,
    notify: (value) => messages.push(value)
  }).deleted, true)
  assert.deepEqual(calls, [{ recipeId: 'summer', observationIndex: 2 }])
  assert.equal(messages.at(-1), '记录已删除')

  assert.equal(orchestrateObservationDelete({
    repository: { deleteRecipeObservation() { throw new Error('offline') } },
    recipeId: 'summer',
    observationIndex: 0,
    notify: (value) => messages.push(value)
  }).deleted, false)
  assert.equal(messages.at(-1), '删除失败，请重试')
})

test('rating toggle saves directly and remembers when an untried recipe was promoted', () => {
  const savedValues = []
  const repository = {
    upsertRecipe(value) {
      savedValues.push(value)
      return value
    }
  }
  const untried = { id: 'new', name: '未调过', tried: false, rating: null }

  const selected = orchestrateRatingToggle({ repository, recipe: untried, rating: '顶尖', promotedFromUntried: false })
  assert.equal(selected.saved, true)
  assert.equal(selected.promotedFromUntried, true)
  assert.equal(selected.recipe.tried, true)
  assert.equal(selected.recipe.rating, '顶尖')

  const changed = orchestrateRatingToggle({ repository, recipe: selected.recipe, rating: '夯', promotedFromUntried: selected.promotedFromUntried })
  assert.equal(changed.promotedFromUntried, true)
  assert.equal(changed.recipe.tried, true)
  assert.equal(changed.recipe.rating, '夯')
  assert.equal(savedValues.length, 2)
})

test('cancelling a selected rating restores only newly promoted recipes to untried', () => {
  const repository = { upsertRecipe: (value) => value }
  const promoted = orchestrateRatingToggle({
    repository,
    recipe: { id: 'promoted', name: '刚刚点过', tried: true, rating: '人上人' },
    rating: '人上人',
    promotedFromUntried: true
  })
  assert.equal(promoted.saved, true)
  assert.equal(promoted.recipe.tried, false)
  assert.equal(promoted.recipe.rating, null)
  assert.equal(promoted.promotedFromUntried, false)

  const alreadyTried = orchestrateRatingToggle({
    repository,
    recipe: { id: 'tried', name: '原本调过', tried: true, rating: 'NPC' },
    rating: 'NPC',
    promotedFromUntried: false
  })
  assert.equal(alreadyTried.saved, true)
  assert.equal(alreadyTried.recipe.tried, true)
  assert.equal(alreadyTried.recipe.rating, null)
  assert.equal(alreadyTried.promotedFromUntried, false)
})

test('rating toggle rejects invalid input and keeps the prior promotion state on save failure', () => {
  const messages = []
  const recipe = { id: 'r1', name: '测试', tried: false, rating: null }
  assert.deepEqual(orchestrateRatingToggle({
    repository: { upsertRecipe: (value) => value }, recipe, rating: '不存在', promotedFromUntried: false,
    notify: (message) => messages.push(message)
  }), { saved: false, recipe: null, promotedFromUntried: false })
  assert.equal(messages.at(-1), '评价选项无效')

  const failed = orchestrateRatingToggle({
    repository: { upsertRecipe() { throw new Error('offline') } },
    recipe: { ...recipe, tried: true, rating: '夯' }, rating: '夯', promotedFromUntried: true,
    notify: (message) => messages.push(message)
  })
  assert.deepEqual(failed, { saved: false, recipe: null, promotedFromUntried: true })
  assert.equal(messages.at(-1), '评价保存失败，请重试')
})

test('repository duplicates a recipe with a fresh ID while reusing all material references', () => {
  let id = 0
  const repository = createRepository(createMemoryAdapter(), {
    idFactory: () => `id-${++id}`,
    now: () => '2026-07-20T00:00:00.000Z'
  })
  repository.initialize()
  const material = repository.upsertMaterial({ name: '金酒', category: 'base-spirit' })
  const original = repository.upsertRecipe({ name: '马天尼', ingredients: [{ materialId: material.id, amount: 60, unit: 'ml' }], rating: '夯' })
  const copy = repository.duplicateRecipe(original.id)

  assert.notEqual(copy.id, original.id)
  assert.equal(copy.name, '马天尼副本')
  assert.deepEqual(copy.ingredients, original.ingredients)
  assert.equal(repository.listMaterials().length, 1)
  assert.equal(repository.listRecipes().length, 2)
  assert.equal(repository.duplicateRecipe('missing'), null)
})

test('repository duplicate retries collisions against every recipe ID and commits only a unique ID', () => {
  const ids = ['original', 'existing', 'original', 'existing', 'unique-copy']
  const repository = createRepository(createMemoryAdapter(), {
    idFactory: () => ids.shift(), now: () => '2026-07-20T00:00:00.000Z'
  })
  repository.initialize()
  const original = repository.upsertRecipe({ name: '原配方' })
  repository.upsertRecipe({ name: '已有配方' })

  const copy = repository.duplicateRecipe(original.id)
  assert.equal(copy.id, 'unique-copy')
  assert.equal(new Set(repository.listRecipes().map(({ id }) => id)).size, 3)
})

test('repository duplicate fails after finite ID collision retries without mutation', () => {
  let calls = 0
  const adapter = createMemoryAdapter()
  const repository = createRepository(adapter, {
    idFactory: () => { calls++; return 'same-id' }, now: () => '2026-07-20T00:00:00.000Z'
  })
  repository.initialize()
  const original = repository.upsertRecipe({ name: '原配方' })
  const before = repository.getState()
  const beforeStorage = adapter.read(STORAGE_KEY)

  assert.throws(() => repository.duplicateRecipe(original.id), /unique recipe ID/i)
  assert.ok(calls > 1 && calls <= 21, `finite idFactory calls: ${calls}`)
  assert.deepEqual(repository.getState(), before)
  assert.deepEqual(adapter.read(STORAGE_KEY), beforeStorage)
})

test('formatDate uses device-local calendar dates and has a safe invalid fallback', () => {
  assert.equal(formatDate('2026-07-19T18:30:00.000Z', 8 * 60), '2026-07-20')
  assert.equal(formatDate('2026-07-19T15:30:00.000Z', 8 * 60), '2026-07-19')
  assert.equal(formatDate(new Date('2026-07-19T18:30:00.000Z'), 8 * 60), '2026-07-20')
  assert.equal(formatDate('not-a-date', 8 * 60), '')
  assert.equal(formatDate(null, 8 * 60), '')
})

test('decodeRecipeId safely handles encoded and malformed deep-link IDs', () => {
  assert.equal(decodeRecipeId('recipe%2Fone'), 'recipe/one')
  assert.equal(decodeRecipeId('%E0%A4%A'), '')
  assert.equal(decodeRecipeId(undefined), '')
})

test('copy and delete orchestration expose success IDs and safe failure feedback', () => {
  const messages = []
  assert.deepEqual(orchestrateRecipeCopy({ repository: { duplicateRecipe: () => ({ id: 'copy' }) }, recipeId: 'r1', notify: (message) => messages.push(message) }), { copied: true, recipeId: 'copy' })
  assert.deepEqual(orchestrateRecipeCopy({ repository: { duplicateRecipe: () => null }, recipeId: 'r1', notify: (message) => messages.push(message) }), { copied: false, recipeId: '' })
  assert.equal(messages.at(-1), '复制失败，请重试')

  const repository = createRepository(createMemoryAdapter(), { idFactory: (() => { let value = 0; return () => `id-${++value}` })() })
  repository.initialize()
  const material = repository.upsertMaterial({ name: '金酒', category: 'base-spirit' })
  const recipe = repository.upsertRecipe({ name: '测试酒', ingredients: [{ materialId: material.id, amount: 40, unit: 'ml' }] })
  assert.deepEqual(orchestrateRecipeDelete({ repository, recipeId: recipe.id, notify: (message) => messages.push(message) }), { deleted: true })
  assert.ok(repository.getMaterial(material.id))
  assert.deepEqual(orchestrateRecipeDelete({ repository, recipeId: 'missing', notify: (message) => messages.push(message) }), { deleted: false })
  assert.equal(messages.at(-1), '删除失败，请重试')
})

test('mini program registers the detail route and wires recipe selection to a stable ID', () => {
  const app = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'))
  const listController = fs.readFileSync('miniprogram/pages/recipes/index.js', 'utf8')
  const detailTemplate = fs.readFileSync('miniprogram/pages/recipe-detail/index.wxml', 'utf8')
  const detailController = fs.readFileSync('miniprogram/pages/recipe-detail/index.js', 'utf8')

  assert.ok(app.pages.includes('pages/recipe-detail/index'))
  assert.match(listController, /event\.detail\.id/)
  assert.match(listController, /pages\/recipe-detail\/index\?id=/)
  for (const handler of ['onEdit', 'onDelete']) {
    assert.match(detailTemplate, new RegExp(`bind(?:tap|change)="${handler}"`))
    assert.match(detailController, new RegExp(`${handler}\\(`))
  }
  assert.doesNotMatch(detailTemplate, /材料观察|onSaveObservation|onObservationMaterialChange/)
  assert.doesNotMatch(detailController, /onSaveObservation\(|onObservationMaterialChange\(/)
  assert.doesNotMatch(detailTemplate, /stateLabel|手头有|随买随用|暂时没有/)
  assert.match(detailTemplate, /aria-label="\{\{item\.accessibilityLabel\}\}"/)
  assert.match(detailTemplate, /detail\.abvBadgeLabel/)
  assert.doesNotMatch(detailTemplate, /detail\.abv\.issueLines|detail\.abv\.ignoredText|去编辑补全/)
  assert.match(detailController, /decodeRecipeId\(query && query\.id\)/)
  assert.doesNotMatch(detailController, /decodeURIComponent/)
})
