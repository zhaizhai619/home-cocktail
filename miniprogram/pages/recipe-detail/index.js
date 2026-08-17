const {
  buildRecipeDetail,
  buildRatioCalculatorGroups,
  scaleRatioCalculatorGroup,
  decodeRecipeId,
  orchestrateRatingToggle,
  orchestrateManualAbvSave,
  orchestrateRecipeCopy,
  orchestrateRecipeDelete
} = require('./model')
const { waitForCloudReady } = require('../../services/page-ready')
const friendMenuPreview = require('../../services/friend-menu-preview')

function getRepository() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.repository
}

function toast(title) {
  if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon: 'none' })
}
Page({
  data: {
    viewerMode: false,
    friendMenu: null,
    detail: { status: 'loading' },
    showMusicReason: false,
    showManualAbvEditor: false,
    manualAbvDraft: '',
    manualAbvError: '',
    expandedPreparationIds: {},
    showRatioCalculator: false,
    ratioCalculatorGroups: []
  },
  async onLoad(query) {
    this.viewerMode = Boolean(query && query.mode === 'friend-preview')
    this.friendMenuId = query && query.menuId
    this.friendMenuValid = false
    this.setData({
      viewerMode: this.viewerMode,
      friendMenu: null,
      detail: { status: 'loading' },
      showManualAbvEditor: false,
      manualAbvError: ''
    })
    if (this.viewerMode) return this.loadFriendDetail(query)
    this.recipeId = decodeRecipeId(query && query.id)
    this.ratingPromotedFromUntried = false
    await waitForCloudReady()
    this.loadDetail()
  },
  async onShow() {
    if (this.viewerMode) return
    await waitForCloudReady()
    if (this.recipeId) this.loadDetail()
  },
  loadFriendDetail(query) {
    const service = this.friendMenuService || friendMenuPreview
    let result
    try {
      result = service.getRecipe(query && query.menuId, query && query.id)
    } catch (_) {
      this.setData({ friendMenu: null, detail: { status: 'missing', message: '好友酒单暂时加载失败，请稍后重试' } })
      return
    }
    if (!result || result.status !== 'ok') {
      let menuResult = null
      try { menuResult = service.getMenu(query && query.menuId) } catch (_) {}
      this.friendMenuValid = Boolean(menuResult && menuResult.status === 'ok')
      this.setData({
        friendMenu: this.friendMenuValid ? menuResult.menu : null,
        detail: { status: 'missing', message: '这款好友酒暂时无法打开' }
      })
      return
    }
    this.friendMenuValid = true
    this.recipeId = result.recipe.id
    this.recipe = result.recipe
    this.setData({
      friendMenu: result.menu,
      detail: buildRecipeDetail(result.recipe, result.materials, result.glassware, result.tools)
    })
    if (typeof wx !== 'undefined' && wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: '好友酒单' })
  },
  loadDetail() {
    const repository = getRepository()
    const recipe = repository && this.recipeId ? repository.getRecipe(this.recipeId) : null
    const detail = buildRecipeDetail(
      recipe,
      repository ? repository.listMaterials() : [],
      repository ? repository.listGlassware() : [],
      repository ? repository.listTools() : []
    )
    this.recipe = recipe
    this.setData({ detail })
    if (detail.status === 'ok' && typeof wx !== 'undefined' && wx.setNavigationBarTitle) {
      wx.setNavigationBarTitle({ title: detail.name || '酒款详情' })
    }
  },
  async onToggleRating(event) {
    if (this.viewerMode) return
    const result = await orchestrateRatingToggle({
      repository: getRepository(),
      recipe: this.recipe,
      rating: event.currentTarget.dataset.rating,
      promotedFromUntried: this.ratingPromotedFromUntried,
      notify: toast
    })
    if (!result.saved) return
    this.ratingPromotedFromUntried = result.promotedFromUntried
    this.loadDetail()
  },
  onOpenMaterial(event) {
    if (this.viewerMode) return
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/material-detail/index?id=${encodeURIComponent(id)}` })
  },
  onTogglePreparationSteps(event) {
    const preparationId = event.currentTarget.dataset.preparationId
    if (!preparationId) return
    this.setData({
      expandedPreparationIds: {
        ...this.data.expandedPreparationIds,
        [preparationId]: !this.data.expandedPreparationIds[preparationId]
      }
    })
  },
  onOpenRatioCalculator() {
    const preparations = this.data.detail && this.data.detail.advancePreparations
    this.setData({
      showRatioCalculator: true,
      ratioCalculatorGroups: buildRatioCalculatorGroups(preparations)
    })
  },
  onCloseRatioCalculator() {
    this.setData({ showRatioCalculator: false, ratioCalculatorGroups: [] })
  },
  onRatioAmountInput(event) {
    const dataset = event.currentTarget.dataset || {}
    this.setData({
      ratioCalculatorGroups: scaleRatioCalculatorGroup(
        this.data.ratioCalculatorGroups,
        dataset.preparationId,
        Number(dataset.ingredientIndex),
        event.detail.value
      )
    })
  },
  onOpenMusicReason() {
    if (this.data.detail && this.data.detail.musicNaming) this.setData({ showMusicReason: true })
  },
  onCloseMusicReason() { this.setData({ showMusicReason: false }) },
  onOpenManualAbv() {
    if (this.viewerMode) return
    const value = this.data.detail.status === 'ok' ? this.data.detail.manualAbv : null
    this.setData({ showManualAbvEditor: true, manualAbvDraft: value === null ? '' : String(value), manualAbvError: '' })
  },
  onCloseManualAbv() { this.setData({ showManualAbvEditor: false, manualAbvError: '' }) },
  onManualAbvInput(event) {
    if (this.viewerMode) return
    this.setData({ manualAbvDraft: event.detail.value || '', manualAbvError: '' })
  },
  async saveManualAbv(value) {
    if (this.viewerMode) return
    const result = await orchestrateManualAbvSave({ repository: getRepository(), recipe: this.recipe, value, notify: toast })
    if (!result.saved) return this.setData({ manualAbvError: result.message })
    this.setData({ showManualAbvEditor: false, manualAbvError: '' })
    this.loadDetail()
  },
  async onSaveManualAbv() {
    if (this.viewerMode) return
    await this.saveManualAbv(this.data.manualAbvDraft)
  },
  async onClearManualAbv() {
    if (this.viewerMode) return
    await this.saveManualAbv('')
  },
  noop() {},
  onEdit() {
    if (this.viewerMode) return
    if (!this.recipeId) return toast('无法编辑这款酒')
    wx.navigateTo({ url: `/pages/recipe-edit/index?id=${encodeURIComponent(this.recipeId)}` })
  },
  async onCopy() {
    if (this.viewerMode) return
    const result = await orchestrateRecipeCopy({ repository: getRepository(), recipeId: this.recipeId, notify: toast })
    if (result.copied) wx.redirectTo({ url: `/pages/recipe-detail/index?id=${encodeURIComponent(result.recipeId)}` })
  },
  onDelete() {
    if (this.viewerMode) return
    if (!this.recipeId || typeof wx === 'undefined' || !wx.showModal) return
    wx.showModal({
      title: '删除这款酒？',
      content: '只会删除酒单中的配方，材料库里的材料会保留。',
      confirmText: '删除',
      confirmColor: '#a54d36',
      success: async ({ confirm }) => {
        if (!confirm) return
        const result = await orchestrateRecipeDelete({ repository: getRepository(), recipeId: this.recipeId, notify: toast })
        if (result.deleted) wx.switchTab({ url: '/pages/recipes/index' })
      }
    })
  },
  onPreviewAction() { toast('真实好友分享接入后开放') },
  onBackToList() {
    if (!this.viewerMode) return wx.switchTab({ url: '/pages/recipes/index' })
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (pages.length > 1 && wx.navigateBack) return wx.navigateBack()
    if (this.friendMenuValid && this.friendMenuId && wx.redirectTo) {
      return wx.redirectTo({ url: `/pages/shared-menu/index?menuId=${encodeURIComponent(this.friendMenuId)}` })
    }
    const app = typeof getApp === 'function' ? getApp() : null
    if (app && app.globalData) app.globalData.sharedMenuReturnIntent = true
    wx.switchTab({ url: '/pages/recipes/index' })
  }
})
