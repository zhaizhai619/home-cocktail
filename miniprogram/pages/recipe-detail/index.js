const {
  buildRecipeDetail,
  decodeRecipeId,
  orchestrateRatingToggle,
  orchestrateManualAbvSave,
  orchestrateRecipeCopy,
  orchestrateRecipeDelete
} = require('./model')
const { waitForCloudReady } = require('../../services/page-ready')

function getRepository() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.repository
}

function toast(title) {
  if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon: 'none' })
}
Page({
  data: {
    detail: { status: 'loading' },
    showManualAbvEditor: false,
    manualAbvDraft: '',
    manualAbvError: '',
    expandedPreparationIds: {}
  },
  async onLoad(query) {
    this.recipeId = decodeRecipeId(query && query.id)
    this.ratingPromotedFromUntried = false
    await waitForCloudReady()
    this.loadDetail()
  },
  async onShow() {
    await waitForCloudReady()
    if (this.recipeId) this.loadDetail()
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
  onOpenManualAbv() {
    const value = this.data.detail.status === 'ok' ? this.data.detail.manualAbv : null
    this.setData({ showManualAbvEditor: true, manualAbvDraft: value === null ? '' : String(value), manualAbvError: '' })
  },
  onCloseManualAbv() { this.setData({ showManualAbvEditor: false, manualAbvError: '' }) },
  onManualAbvInput(event) { this.setData({ manualAbvDraft: event.detail.value || '', manualAbvError: '' }) },
  async saveManualAbv(value) {
    const result = await orchestrateManualAbvSave({ repository: getRepository(), recipe: this.recipe, value, notify: toast })
    if (!result.saved) return this.setData({ manualAbvError: result.message })
    this.setData({ showManualAbvEditor: false, manualAbvError: '' })
    this.loadDetail()
  },
  async onSaveManualAbv() { await this.saveManualAbv(this.data.manualAbvDraft) },
  async onClearManualAbv() { await this.saveManualAbv('') },
  noop() {},
  onEdit() {
    if (!this.recipeId) return toast('无法编辑这款酒')
    wx.navigateTo({ url: `/pages/recipe-edit/index?id=${encodeURIComponent(this.recipeId)}` })
  },
  async onCopy() {
    const result = await orchestrateRecipeCopy({ repository: getRepository(), recipeId: this.recipeId, notify: toast })
    if (result.copied) wx.redirectTo({ url: `/pages/recipe-detail/index?id=${encodeURIComponent(result.recipeId)}` })
  },
  onDelete() {
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
  onBackToList() { wx.switchTab({ url: '/pages/recipes/index' }) }
})
