const assert = require('node:assert/strict')
const test = require('node:test')

const { calculateAbv } = require('../miniprogram/domain/abv')

test('calculates ABV from alcoholic volume over all ml ingredients', () => {
  assert.deepEqual(calculateAbv([
    { name: '金酒', amount: 40, unit: 'ml', alcoholic: true, abv: 40 },
    { name: '柠檬汁', amount: 20, unit: 'ml', alcoholic: false },
    { name: '糖浆', amount: 20, unit: 'ml', alcoholic: false }
  ]), {
    status: 'ok', abv: 20, liquidVolume: 80, missing: [], ignored: []
  })
})

test('counts a nonalcoholic top-up as 100ml', () => {
  assert.deepEqual(calculateAbv([
    { name: '金酒', amount: 40, unit: 'ml', alcoholic: true, abv: 40 },
    { name: '汤力水', unit: 'top-up', alcoholic: false }
  ]), {
    status: 'ok', abv: 11.4, liquidVolume: 140, missing: [], ignored: []
  })
})

test('counts fruit recorded in ml regardless of material form', () => {
  assert.equal(calculateAbv([
    { name: '金酒', amount: 40, unit: 'ml', alcoholic: true, abv: 40 },
    { name: '西瓜', amount: 40, unit: 'ml', form: 'solid', alcoholic: false }
  ]).abv, 20)
})

test('ignores nonalcoholic entries recorded in non-volume units', () => {
  const ingredients = ['g', 'piece', 'slice', 'drop', 'chunk', 'to-taste']
    .map((unit, index) => ({
      name: `配料${index + 1}`,
      amount: 1,
      unit,
      alcoholic: false
    }))

  assert.deepEqual(calculateAbv([
    { name: '金酒', amount: 40, unit: 'ml', alcoholic: true, abv: 40 },
    ...ingredients
  ]), {
    status: 'ok',
    abv: 40,
    liquidVolume: 40,
    missing: [],
    ignored: ingredients.map(({ name }) => name)
  })
})

test('does not return a partial ABV when an alcoholic ingredient lacks ABV', () => {
  const result = calculateAbv([
    { name: '金酒', amount: 40, unit: 'ml', alcoholic: true, abv: 40 },
    { name: '紫罗兰利口酒', amount: 10, unit: 'ml', alcoholic: true }
  ])

  assert.deepEqual(result, {
    status: 'missing',
    abv: null,
    liquidVolume: 50,
    missing: ['紫罗兰利口酒'],
    ignored: []
  })
})

test('requires alcoholic ingredients to use a calculable ml amount', () => {
  for (const unit of ['drop', 'to-taste', 'top-up']) {
    const result = calculateAbv([
      { name: '苦精', amount: 2, unit, alcoholic: true, abv: 45 },
      { name: '水', amount: 20, unit: 'ml', alcoholic: false }
    ])
    assert.equal(result.status, 'missing', unit)
    assert.equal(result.abv, null, unit)
    assert.deepEqual(result.missing, ['苦精'], unit)
  }
})

test('counts every valid ml entry in the denominator', () => {
  assert.deepEqual(calculateAbv([
    { name: '金酒', amount: 30, unit: 'ml', alcoholic: true, abv: 40 },
    { name: '无酒精开胃酒', amount: 30, unit: 'ml', alcoholic: false, abv: 0 },
    { name: '果汁', amount: 60, unit: 'ml', alcoholic: false }
  ]), {
    status: 'ok', abv: 10, liquidVolume: 120, missing: [], ignored: []
  })
})

test('returns a safe missing result when there is no calculable liquid', () => {
  for (const ingredients of [undefined, [], [
    { name: '柠檬皮', amount: 1, unit: 'slice', alcoholic: false }
  ]]) {
    const result = calculateAbv(ingredients)
    assert.equal(result.status, 'missing')
    assert.equal(result.abv, null)
    assert.equal(result.liquidVolume, 0)
    assert.ok(result.missing.includes('没有可计算的液体材料'))
  }
})

test('handles invalid amounts deterministically by alcohol status', () => {
  const result = calculateAbv([
    { name: '金酒', amount: -10, unit: 'ml', alcoholic: true, abv: 40 },
    { name: '伏特加', amount: Infinity, unit: 'ml', alcoholic: true, abv: 40 },
    { name: '果汁', amount: NaN, unit: 'ml', alcoholic: false },
    { name: '水', amount: 20, unit: 'ml', alcoholic: false }
  ])

  assert.deepEqual(result, {
    status: 'missing',
    abv: null,
    liquidVolume: 20,
    missing: ['金酒', '伏特加'],
    ignored: ['果汁']
  })
})
