const { filterAndSortRecipeCards } = require('./model')

const PREP_CHIPS = [
  { key: 'all', label: '全部' },
  { key: '即调', label: '即调' },
  { key: '冷冻', label: '冷冻' },
  { key: '冷泡/浸泡', label: '冷泡' },
  { key: '奶洗', label: '奶洗' },
  { key: '低温慢煮', label: '低温慢煮' },
  { key: '其他预制', label: '其他预制' }
]
const MATERIAL_OPTIONS = [
  { key: 'all', label: '全部酒单', shortLabel: '全部' },
  { key: 'on-hand', label: '手头就能做', shortLabel: '手头可做' },
  { key: 'fresh-only', label: '补点鲜材就能做', shortLabel: '补点鲜材' }
]
const SORT_OPTIONS = [
  { key: 'prep-time', label: '准备时间最短' },
  { key: 'recent', label: '最近添加' },
  { key: 'rating', label: '评价档位' },
  { key: 'name', label: '名称排序' }
]

function repositoryData() {
  const app = typeof getApp === 'function' ? getApp() : null
  const repository = app && app.globalData && app.globalData.repository
  if (!repository) return { recipes: [], materialsById: {} }
  const materials = typeof repository.listMaterials === 'function' ? repository.listMaterials() : []
  return {
    recipes: typeof repository.listRecipes === 'function' ? repository.listRecipes() : [],
    materialsById: (Array.isArray(materials) ? materials : []).reduce((lookup, material) => {
      if (material && typeof material.id === 'string') lookup[material.id] = material
      return lookup
    }, {})
  }
}

Page({
  data: {
    prepChips: PREP_CHIPS,
    materialOptions: MATERIAL_OPTIONS,
    sortOptions: SORT_OPTIONS,
    recipes: [],
    search: '',
    prepType: 'all',
    materialCondition: 'all',
    materialConditionLabel: '全部',
    sortKey: 'prep-time',
    showMaterialSheet: false
  },
  onShow() {
    const source = repositoryData()
    this.recipesSource = source.recipes
    this.materialsById = source.materialsById
    this.refreshCards()
  },
  refreshCards() {
    const data = this.data
    this.setData({ recipes: filterAndSortRecipeCards(this.recipesSource, this.materialsById, data) })
  },
  onSearchInput(event) {
    this.setData({ search: event.detail.value || '' })
    this.refreshCards()
  },
  onSelectPrep(event) {
    this.setData({ prepType: event.currentTarget.dataset.key || 'all' })
    this.refreshCards()
  },
  openMaterialSheet() { this.setData({ showMaterialSheet: true }) },
  closeMaterialSheet() { this.setData({ showMaterialSheet: false }) },
  onSelectMaterial(event) {
    const key = event.currentTarget.dataset.key || 'all'
    const option = MATERIAL_OPTIONS.find((item) => item.key === key) || MATERIAL_OPTIONS[0]
    this.setData({ materialCondition: key, materialConditionLabel: option.shortLabel, showMaterialSheet: false })
    this.refreshCards()
  },
  onSelectSort(event) {
    this.setData({ sortKey: event.currentTarget.dataset.key || 'prep-time' })
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
