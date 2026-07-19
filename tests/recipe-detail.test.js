const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { RATINGS } = require('../miniprogram/domain/constants')
const {
  buildRecipeDetail,
  validateObservation,
  orchestrateObservationSave,
  orchestrateRecipeCopy,
  orchestrateRecipeDelete
} = require('../miniprogram/pages/recipe-detail/model')
const { createRepository } = require('../miniprogram/services/repository')

function createMemoryAdapter() {
  const values = new Map()
  return {
    get(key) { return values.get(key) },
    set(key, value) { values.set(key, value) }
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
  assert.deepEqual(detail.ingredients.map(({ name, amountLabel, state, unavailable }) => ({ name, amountLabel, state, unavailable })), [
    { name: '金酒', amountLabel: '40ml', state: 'owned', unavailable: false },
    { name: '西瓜', amountLabel: '100ml', state: 'quick-buy', unavailable: true },
    { name: '接骨木花利口酒', amountLabel: '10ml', state: 'missing-long-term', unavailable: true },
    { name: '汤力水', amountLabel: '补满', state: 'owned', unavailable: false }
  ])
  assert.deepEqual(detail.abv, { status: 'ok', valueLabel: '7.2%', liquidVolumeLabel: '250ml', missingText: '' })
  assert.deepEqual(detail.glassware, { id: 'highball', name: '海波杯', capacityLabel: '300ml' })
  assert.deepEqual(detail.tools.map(({ name }) => name), ['摇酒壶', '滤冰器'])
  assert.deepEqual(detail.steps, ['摇和除汤力水外的材料', '滤入杯中并补满汤力水'])
  assert.deepEqual(detail.ratings, RATINGS.map((label) => ({ label, selected: label === '顶尖' })))
  assert.deepEqual(detail.observations, [{ materialId: 'watermelon', materialName: '西瓜', note: '无籽西瓜更省事', createdAtLabel: '2026-07-19' }])
  assert.deepEqual(fixture, snapshot)
})

test('buildRecipeDetail reports orphan references and missing ABV instead of showing a partial result', () => {
  const detail = buildRecipeDetail({
    id: 'broken', name: '待补资料',
    ingredients: [{ materialId: 'unknown', amount: 20, unit: 'ml' }, { materialId: 'amaro', amount: 20, unit: 'ml' }]
  }, [{ id: 'amaro', name: '阿玛罗', acquisition: 'long-term', owned: true, alcoholic: true, abv: null }])

  assert.equal(detail.ingredients[0].orphaned, true)
  assert.equal(detail.ingredients[0].name, '缺失材料')
  assert.deepEqual(detail.abv, { status: 'missing', valueLabel: '--', liquidVolumeLabel: '20ml', missingText: '缺失材料、阿玛罗' })
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
  for (const handler of ['onEdit', 'onCopy', 'onDelete', 'onSaveObservation', 'onObservationMaterialChange']) {
    assert.match(detailTemplate, new RegExp(`bind(?:tap|change)="${handler}"`))
    assert.match(detailController, new RegExp(`${handler}\\(`))
  }
})
