const { RATINGS } = require('../../domain/constants')
const { filterAndSortRecipeCards } = require('./model')

const PREP_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: '即调', label: '即调' },
  { key: '冷冻', label: '冷冻' },
  { key: '冷泡/浸泡', label: '冷泡/浸泡', shortLabel: '冷泡' },
  { key: '奶洗', label: '奶洗' },
  { key: '低温慢煮', label: '低温慢煮' },
  { key: '其他预调', label: '其他预调' }
]
const MATERIAL_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'on-hand', label: '手头就能做', shortLabel: '手头可做' },
  { key: 'fresh-only', label: '补新鲜食材就能做', shortLabel: '补鲜材' }
]
const RATING_OPTIONS = [{ key: 'all', label: '全部' }, ...RATINGS.map((rating) => ({ key: rating, label: rating }))]
const SORT_OPTIONS = [
  { key: 'prep-time', label: '准备时间最短' },
  { key: 'recent', label: '最近添加' },
  { key: 'rating', label: '评价档位' },
  { key: 'name', label: '名称排序' }
]
const SHEETS = {
  preparation: { title: '制作方式', options: PREP_OPTIONS, value: 'prepType', label: 'prepTypeLabel' },
  material: { title: '材料条件', options: MATERIAL_OPTIONS, value: 'materialCondition', label: 'materialConditionLabel' },
  rating: { title: '评价', options: RATING_OPTIONS, value: 'rating', label: 'ratingLabel' },
  sort: { title: '排序方式', options: SORT_OPTIONS, value: 'sortKey', label: 'sortLabel' }
}

function repositoryData() {
  const app = typeof getApp === 'function' ? getApp() : null
  const repository = app && app.globalData && app.globalData.repository
  if (!repository) return { recipes: [], materialsById: Object.create(null) }
  const materials = typeof repository.listMaterials === 'function' ? repository.listMaterials() : []
  return {
    recipes: typeof repository.listRecipes === 'function' ? repository.listRecipes() : [],
    materialsById: (Array.isArray(materials) ? materials : []).reduce((lookup, material) => {
      if (material && typeof material.id === 'string') lookup[material.id] = material
      return lookup
    }, Object.create(null))
  }
}

Page({
  data: {
    recipes: [],
    search: '',
    prepType: 'all',
    prepTypeLabel: '全部',
    materialCondition: 'all',
    materialConditionLabel: '全部',
    rating: 'all',
    ratingLabel: '全部',
    untriedOnly: false,
    sortKey: 'prep-time',
    sortLabel: '准备时间最短',
    hasRecipes: false,
    sheetOpen: false,
    sheetKind: '',
    sheetTitle: '',
    sheetOptions: [],
    sheetValue: ''
  },
  onShow() {
    const source = repositoryData()
    this.recipesSource = source.recipes
    this.materialsById = source.materialsById
    this.setData({ hasRecipes: source.recipes.length > 0 })
    this.refreshCards()
  },
  refreshCards() {
    this.setData({ recipes: filterAndSortRecipeCards(this.recipesSource, this.materialsById, this.data) })
  },
  onSearchInput(event) {
    this.setData({ search: event.detail.value || '' })
    this.refreshCards()
  },
  onToggleUntried() {
    this.setData({ untriedOnly: !this.data.untriedOnly })
    this.refreshCards()
  },
  openFilter(event) {
    const kind = event.currentTarget.dataset.filter
    const config = SHEETS[kind]
    if (!config) return
    this.setData({
      sheetOpen: true,
      sheetKind: kind,
      sheetTitle: config.title,
      sheetOptions: config.options,
      sheetValue: this.data[config.value]
    })
  },
  openSortSheet() {
    const config = SHEETS.sort
    this.setData({
      sheetOpen: true,
      sheetKind: 'sort',
      sheetTitle: config.title,
      sheetOptions: config.options,
      sheetValue: this.data.sortKey
    })
  },
  closeSheet() { this.setData({ sheetOpen: false }) },
  onSelectSheet(event) {
    const config = SHEETS[this.data.sheetKind]
    const key = event.currentTarget.dataset.key
    const option = config && config.options.find((item) => item.key === key)
    if (!config || !option) return
    this.setData({ [config.value]: option.key, [config.label]: option.shortLabel || option.label, sheetOpen: false })
    this.refreshCards()
  },
  clearFilters() {
    this.setData({
      search: '',
      prepType: 'all',
      prepTypeLabel: '全部',
      materialCondition: 'all',
      materialConditionLabel: '全部',
      rating: 'all',
      ratingLabel: '全部',
      untriedOnly: false,
      sheetOpen: false
    })
    this.refreshCards()
  },
  noop() {},
  onAddRecipe() { wx.navigateTo({ url: '/pages/recipe-edit/index' }) },
  onSelectRecipe(event) {
    const id = event && event.detail && event.detail.id
    if (!id) return wx.showToast({ title: '无法打开这款酒', icon: 'none' })
    wx.navigateTo({ url: `/pages/recipe-detail/index?id=${encodeURIComponent(id)}` })
  }
})
