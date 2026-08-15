const PREP_TYPES = Object.freeze([
  '即调',
  '冷冻',
  '冷泡/浸泡',
  '奶洗',
  '低温慢煮',
  '其他预调'
])

const PREP_ENTRY_TYPES = Object.freeze(PREP_TYPES.filter((type) => type !== '其他预调'))

function normalizePreparationType(type) {
  return type === '其他预制' ? '其他预调' : type
}

const RATINGS = Object.freeze(['夯', '顶尖', '人上人', 'NPC', '拉完了'])

const QUICK_BASE_SPIRITS = Object.freeze([
  Object.freeze({ id: 'gin', name: '金酒', abv: 40 }),
  Object.freeze({ id: 'white-rum', name: '白朗姆', abv: 40 }),
  Object.freeze({ id: 'whiskey', name: '威士忌', abv: 40 }),
  Object.freeze({ id: 'vodka', name: '伏特加', abv: 40 }),
  Object.freeze({ id: 'tequila', name: '龙舌兰', abv: 40 })
])

const QUICK_TOOLS = Object.freeze([
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

const UNITS = Object.freeze([
  Object.freeze({ value: 'ml', label: 'ml' }),
  Object.freeze({ value: 'g', label: 'g' }),
  Object.freeze({ value: 'piece', label: '个' }),
  Object.freeze({ value: 'slice', label: '片' }),
  Object.freeze({ value: 'drop', label: '滴' }),
  Object.freeze({ value: 'chunk', label: '块' }),
  Object.freeze({ value: 'top-up', label: '补满' }),
  Object.freeze({ value: 'to-taste', label: '适量' })
])

const RECIPE_UNITS = Object.freeze([
  Object.freeze({ value: 'ml', label: 'ml' }),
  Object.freeze({ value: 'g', label: 'g' }),
  Object.freeze({ value: 'piece', label: '个' }),
  Object.freeze({ value: 'top-up', label: '补满' }),
  Object.freeze({ value: 'to-taste', label: '适量' }),
  Object.freeze({ value: 'chunk', label: '块' }),
  Object.freeze({ value: 'drop', label: '滴' })
])

module.exports = {
  PREP_TYPES,
  PREP_ENTRY_TYPES,
  RATINGS,
  QUICK_BASE_SPIRITS,
  QUICK_TOOLS,
  UNITS,
  RECIPE_UNITS,
  normalizePreparationType
}
