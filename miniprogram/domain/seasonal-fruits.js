// Source of truth: docs/时令水果.xlsx
const SEASONAL_FRUITS_BY_MONTH = Object.freeze({
  1: ['草莓', '砂糖橘', '橙子'],
  2: ['草莓', '砂糖橘', '阳光玫瑰'],
  3: [],
  4: ['菠萝'],
  5: ['菠萝', '芒果', '荔枝', '山竹'],
  6: ['菠萝', '芒果', '杨梅', '荔枝', '西瓜', '哈密瓜', '山竹', '蓝莓'],
  7: ['芒果', '桃子', '西瓜', '哈密瓜', '山竹', '芭乐', '蓝莓'],
  8: ['桃子', '西瓜', '无花果', '哈密瓜', '木瓜', '蓝莓', '猕猴桃', '西梅', '芭乐'],
  9: ['石榴', '无花果', '哈密瓜', '木瓜', '猕猴桃', '西梅', '芭乐'],
  10: ['石榴', '柚子', '无花果', '木瓜', '橙子', '猕猴桃', '芭乐'],
  11: ['柚子', '木瓜', '橙子', '猕猴桃', '芭乐'],
  12: ['草莓', '砂糖橘', '柚子', '橙子', '芭乐']
})

function getSeasonalFruits(month) {
  const value = Number(month)
  if (!Number.isInteger(value) || value < 1 || value > 12) return []
  return [...SEASONAL_FRUITS_BY_MONTH[value]]
}

function buildSeasonalFruitMessage(month) {
  const fruits = getSeasonalFruits(month)
  return fruits.length ? `当季的时令水果有：${fruits.join('、')}，调酒口感更佳哦～` : ''
}

module.exports = { SEASONAL_FRUITS_BY_MONTH, getSeasonalFruits, buildSeasonalFruitMessage }
