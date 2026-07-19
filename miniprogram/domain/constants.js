const PREP_TYPES = Object.freeze([
  '即调',
  '冷冻',
  '冷泡/浸泡',
  '奶洗',
  '低温慢煮',
  '其他预制'
])

const RATINGS = Object.freeze(['夯', '顶尖', '人上人', 'NPC', '拉完了'])

const QUICK_BASE_SPIRITS = Object.freeze([
  '金酒',
  '白朗姆',
  '威士忌',
  '伏特加',
  '龙舌兰'
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

module.exports = {
  PREP_TYPES,
  RATINGS,
  QUICK_BASE_SPIRITS,
  QUICK_TOOLS,
  UNITS
}
