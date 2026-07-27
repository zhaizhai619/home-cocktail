const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const modulePath = path.resolve(__dirname, '../miniprogram/domain/seasonal-fruits.js')

test('seasonal fruit data mirrors the maintained workbook and formats the monthly hint', () => {
  assert.equal(fs.existsSync(modulePath), true, 'seasonal fruit module should exist')
  const { getSeasonalFruits, buildSeasonalFruitMessage } = require(modulePath)

  assert.deepEqual(getSeasonalFruits(1), ['草莓', '砂糖橘', '橙子'])
  assert.deepEqual(getSeasonalFruits(7), ['芒果', '桃子', '西瓜', '哈密瓜', '山竹', '芭乐', '蓝莓'])
  assert.deepEqual(getSeasonalFruits(12), ['草莓', '砂糖橘', '柚子', '橙子', '芭乐'])
  assert.deepEqual(getSeasonalFruits(3), [])
  assert.deepEqual(getSeasonalFruits(0), [])
  assert.deepEqual(getSeasonalFruits(13), [])
  assert.equal(buildSeasonalFruitMessage(7), '当季的时令水果有：芒果、桃子、西瓜、哈密瓜、山竹、芭乐、蓝莓，调酒口感更佳哦～')
  assert.equal(buildSeasonalFruitMessage(3), '')
})
