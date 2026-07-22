const {
  buildRecipeDetail,
  decodeRecipeId,
  validateObservation,
  orchestrateObservationSave,
  orchestrateRatingToggle,
  orchestrateRecipeCopy,
  orchestrateRecipeDelete
} = require('./model')

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
    observationMaterialIndex: 0,
    observationMaterialLabel: '选择材料',
    observationNote: '',
    observationError: ''
  },
  onLoad(query) {
    this.recipeId = decodeRecipeId(query && query.id)
    this.ratingPromotedFromUntried = false
    this.loadDetail()
  },
  onShow() {
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
    const options = detail.status === 'ok' ? detail.ingredientOptions : []
    const current = options[this.data.observationMaterialIndex]
    const nextIndex = current ? this.data.observationMaterialIndex : 0
    const selected = options[nextIndex]
    this.setData({
      detail,
      observationMaterialIndex: nextIndex,
      observationMaterialLabel: selected ? selected.name : '选择材料'
    })
    if (detail.status === 'ok' && typeof wx !== 'undefined' && wx.setNavigationBarTitle) {
      wx.setNavigationBarTitle({ title: detail.name || '酒款详情' })
    }
  },
  onObservationMaterialChange(event) {
    const index = Number(event.detail.value)
    const option = this.data.detail.ingredientOptions[index]
    this.setData({ observationMaterialIndex: Number.isInteger(index) ? index : 0, observationMaterialLabel: option ? option.name : '选择材料', observationError: '' })
  },
  onObservationInput(event) { this.setData({ observationNote: event.detail.value || '', observationError: '' }) },
  onToggleRating(event) {
    const result = orchestrateRatingToggle({
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
  onSaveObservation() {
    const options = this.data.detail.status === 'ok' ? this.data.detail.ingredientOptions : []
    const selected = options[this.data.observationMaterialIndex]
    const validation = validateObservation(this.recipe, selected ? selected.id : '', this.data.observationNote)
    if (!validation.valid) { this.setData({ observationError: validation.message }); toast(validation.message); return }
    const result = orchestrateObservationSave({
      repository: getRepository(), recipe: this.recipe,
      materialId: selected ? selected.id : '', note: this.data.observationNote, notify: toast
    })
    if (result.saved) {
      this.setData({ observationNote: '', observationError: '' })
      this.loadDetail()
    } else this.setData({ observationError: '保存失败，请重试' })
  },
  onOpenMaterial(event) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/material-detail/index?id=${encodeURIComponent(id)}` })
  },
  onEditMissingAbv() {
    const detail = this.data.detail
    const id = detail && detail.status === 'ok' && detail.abv && detail.abv.editMaterialId
    if (id) wx.navigateTo({ url: `/pages/material-edit/index?id=${encodeURIComponent(id)}` })
  },
  onEdit() {
    if (!this.recipeId) return toast('无法编辑这款酒')
    wx.navigateTo({ url: `/pages/recipe-edit/index?id=${encodeURIComponent(this.recipeId)}` })
  },
  onCopy() {
    const result = orchestrateRecipeCopy({ repository: getRepository(), recipeId: this.recipeId, notify: toast })
    if (result.copied) wx.redirectTo({ url: `/pages/recipe-detail/index?id=${encodeURIComponent(result.recipeId)}` })
  },
  onDelete() {
    if (!this.recipeId || typeof wx === 'undefined' || !wx.showModal) return
    wx.showModal({
      title: '删除这款酒？',
      content: '只会删除酒单中的配方，材料库里的材料会保留。',
      confirmText: '删除',
      confirmColor: '#a54d36',
      success: ({ confirm }) => {
        if (!confirm) return
        const result = orchestrateRecipeDelete({ repository: getRepository(), recipeId: this.recipeId, notify: toast })
        if (result.deleted) wx.switchTab({ url: '/pages/recipes/index' })
      }
    })
  },
  onBackToList() { wx.switchTab({ url: '/pages/recipes/index' }) }
})
