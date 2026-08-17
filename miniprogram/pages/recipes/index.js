const { RATINGS } = require('../../domain/constants')
const { buildSeasonalFruitMessage } = require('../../domain/seasonal-fruits')
const { filterAndSortRecipeCards } = require('./model')
const { waitForCloudReady } = require('../../services/page-ready')
const friendMenuPreview = require('../../services/friend-menu-preview')

const PREP_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: '即调', label: '即调' },
  { key: '冷冻', label: '冷冻' },
  { key: '冷泡/浸泡', label: '冷泡/浸泡', shortLabel: '冷泡' },
  { key: '奶洗', label: '奶洗' },
  { key: '低温慢煮', label: '低温慢煮', shortLabel: '低温' }
]
const MATERIAL_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'on-hand', label: '手头就能做', shortLabel: '手头可做' },
  { key: 'fresh-only', label: '补新鲜食材就能做', shortLabel: '补鲜材' }
]
const RATING_OPTIONS = [{ key: 'all', label: '全部' }, ...RATINGS.map((rating) => ({ key: rating, label: rating }))]
const SORT_OPTIONS = [
  { key: 'recent', label: '最近添加', shortLabel: '最近' },
  { key: 'prep-time', label: '准备时间最短', shortLabel: '准备最短' },
  { key: 'rating', label: '评价档位', shortLabel: '评价' },
  { key: 'name', label: '名称排序', shortLabel: '名称' }
]
const STATUS_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'tried', label: '仅看调过', shortLabel: '调过' },
  { key: 'untried', label: '仅看未调过', shortLabel: '未调过' }
]
const FILTERS = {
  preparation: { title: '制作方式', options: PREP_OPTIONS, value: 'prepType', label: 'prepTypeLabel' },
  material: { title: '材料条件', options: MATERIAL_OPTIONS, value: 'materialCondition', label: 'materialConditionLabel' },
  rating: { title: '评价', options: RATING_OPTIONS, value: 'rating', label: 'ratingLabel' },
  sort: { title: '排序方式', options: SORT_OPTIONS, value: 'sortKey', label: 'sortLabel' }
}
const DEFAULT_FILTERS = {
  prepType: 'all',
  prepTypeLabel: '全部',
  materialCondition: 'all',
  materialConditionLabel: '全部',
  rating: 'all',
  ratingLabel: '全部',
  triedStatus: 'all',
  sortKey: 'recent',
  sortLabel: '最近添加'
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

async function loadPersonalRecipes(page) {
  const loadId = (page.personalLoadId || 0) + 1
  page.personalLoadId = loadId
  if (page.personalRecipesLoaded !== true) page.setData({ loadingRecipes: true })
  await waitForCloudReady()
  if (page.personalLoadId !== loadId || page.data.activeSource !== 'mine') return
  const source = repositoryData()
  page.recipesSource = source.recipes
  page.materialsById = source.materialsById
  page.setData({
    hasRecipes: source.recipes.length > 0,
    seasonalFruitMessage: buildSeasonalFruitMessage(new Date().getMonth() + 1)
  })
  page.refreshCards()
  page.personalRecipesLoaded = true
  page.setData({ loadingRecipes: false })
}

Page({
  data: {
    activeSource: 'mine',
    friendMenus: [],
    friendMenusState: 'idle',
    friendMenusError: '',
    recipes: [],
    search: '',
    seasonalFruitMessage: '',
    prepType: 'all',
    prepTypeLabel: '全部',
    materialCondition: 'all',
    materialConditionLabel: '全部',
    rating: 'all',
    ratingLabel: '全部',
    triedStatus: 'all',
    sortKey: 'recent',
    sortLabel: '最近添加',
    loadingRecipes: true,
    hasRecipes: false,
    filterPanelOpen: false,
    prepOptions: PREP_OPTIONS,
    materialOptions: MATERIAL_OPTIONS,
    ratingOptions: RATING_OPTIONS,
    sortOptions: SORT_OPTIONS,
    statusOptions: STATUS_OPTIONS
  },
  async onShow() {
    const app = typeof getApp === 'function' ? getApp() : null
    const globalData = app && app.globalData
    if (globalData && globalData.sharedMenuReturnIntent === true) {
      globalData.sharedMenuReturnIntent = false
      this.setData({ activeSource: 'shared', filterPanelOpen: false })
    }
    if (this.data.activeSource === 'shared') return this.loadFriendMenus()
    return loadPersonalRecipes(this)
  },
  async loadPersonalRecipes() {
    return loadPersonalRecipes(this)
  },
  loadFriendMenus() {
    this.personalLoadId = (this.personalLoadId || 0) + 1
    const service = this.friendMenuService || friendMenuPreview
    this.setData({ friendMenusState: 'loading', friendMenusError: '' })
    try {
      const menus = service.listMenus()
      this.setData({
        friendMenus: Array.isArray(menus) ? menus : [],
        friendMenusState: Array.isArray(menus) && menus.length ? 'ok' : 'empty'
      })
    } catch (_) {
      this.setData({ friendMenus: [], friendMenusState: 'error', friendMenusError: '好友酒单暂时加载失败' })
    }
  },
  async onSelectSource(event) {
    const source = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.source
    if (!['mine', 'shared'].includes(source) || source === this.data.activeSource) return
    this.setData({ activeSource: source, filterPanelOpen: false })
    if (source === 'shared') return this.loadFriendMenus()
    return loadPersonalRecipes(this)
  },
  onRetryFriendMenus() { this.loadFriendMenus() },
  onSelectFriendMenu(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/shared-menu/index?menuId=${encodeURIComponent(id)}` })
  },
  refreshCards() {
    this.setData({ recipes: filterAndSortRecipeCards(this.recipesSource, this.materialsById, this.data) })
  },
  onSearchInput(event) {
    this.setData({ search: event.detail.value || '' })
    this.refreshCards()
  },
  toggleFilterPanel() {
    this.setData({ filterPanelOpen: !this.data.filterPanelOpen })
  },
  collapseFilterPanel() {
    this.setData({ filterPanelOpen: false })
  },
  onSelectFilterOption(event) {
    const { kind, key } = event.currentTarget.dataset
    if (kind === 'status') {
      if (!STATUS_OPTIONS.some((option) => option.key === key)) return
      this.setData({ triedStatus: key })
      this.refreshCards()
      return
    }
    const config = FILTERS[kind]
    const option = config && config.options.find((item) => item.key === key)
    if (!config || !option) return
    this.setData({ [config.value]: option.key, [config.label]: option.shortLabel || option.label })
    this.refreshCards()
  },
  resetFilterPanel() {
    this.setData({ ...DEFAULT_FILTERS, filterPanelOpen: true })
    this.refreshCards()
  },
  clearFilters() {
    this.setData({
      search: '',
      ...DEFAULT_FILTERS,
      filterPanelOpen: false
    })
    this.refreshCards()
  },
  noop() {},
  onOpenMusicNaming() { wx.navigateTo({ url: '/pages/music-naming/index' }) },
  onAddRecipe() { wx.navigateTo({ url: '/pages/recipe-edit/index' }) },
  onSelectRecipe(event) {
    const id = event && event.detail && event.detail.id
    if (!id) return wx.showToast({ title: '无法打开这款酒', icon: 'none' })
    wx.navigateTo({ url: `/pages/recipe-detail/index?id=${encodeURIComponent(id)}` })
  }
})
