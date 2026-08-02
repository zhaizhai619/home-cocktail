const { UNITS } = require('../../domain/constants')
const { MATERIAL_LIBRARY_TABS, buildMaterialLibrary, buildGlasswareCards, buildFreshFormState, buildFreshRemainingEditorState, ensureLibraryMaterial, prepareGlasswareForSave, orchestrateFreshRemainingSave, orchestrateFreshUseUp, orchestrateFreshUndo } = require('./model')
const { validateGlasswareForm, orchestrateGlasswareSave, orchestrateEquipmentDelete, orchestrateGlasswareMediaDelete } = require('../settings/model')
const { waitForCloudReady } = require('../../services/page-ready')

function repository() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.repository
}

function mediaFiles() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.mediaFiles
}

function toast(title) {
  if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon: 'none' })
}

Page({
  data: {
    barTabIndex: 0,
    categoryTabs: MATERIAL_LIBRARY_TABS,
    units: UNITS,
    unitLabels: UNITS.map(({ label }) => label),
    search: '',
    categoryFilter: 'all',
    searchMatchCategoryKeys: [],
    freshShelf: [],
    freshShelfExpanded: true,
    expandedFreshMaterialId: '',
    materials: [],
    glassware: [],
    glassEditorOpen: false,
    glassEditorTitle: '新增酒杯',
    glassForm: { id: '', name: '', capacityMl: '', imagePath: '', notes: '' },
    glassError: '',
    savingGlass: false,
    showFreshForm: false,
    freshDraft: { materialId: '', name: '', trackFreshness: false, remainingAmount: '', remainingUnit: 'ml', expiresAt: '' },
    freshUnitIndex: 0,
    freshError: '',
    remainingEditorOpen: false,
    remainingDraft: { materialId: '', name: '', remainingAmount: '', remainingUnit: 'ml' },
    remainingUnitIndex: 0,
    remainingError: '',
    undo: null
  },
  async onShow() { await waitForCloudReady(); this.reload() },
  onUnload() { if (this.undoTimer) clearTimeout(this.undoTimer) },
  reload() {
    const repo = repository()
    const view = buildMaterialLibrary(repo ? repo.listMaterials() : [], repo ? repo.listRecipes() : [], { ...this.data, includeCatalog: true })
    const expandedFreshMaterialId = view.freshShelf.some(({ id }) => id === this.data.expandedFreshMaterialId)
      ? this.data.expandedFreshMaterialId
      : ''
    this.setData({ ...view, expandedFreshMaterialId, glassware: buildGlasswareCards(repo ? repo.listGlassware() : []) })
  },
  onSelectBarTab(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ barTabIndex: index === 1 ? 1 : 0 })
  },
  onBarSwiperChange(event) { this.setData({ barTabIndex: Number(event.detail.current) === 1 ? 1 : 0 }) },
  onSearchInput(event) { this.setData({ search: event.detail.value || '' }); this.reload() },
  onSelectCategory(event) {
    const categoryFilter = event.currentTarget.dataset.key || 'all'
    const hasSearch = Boolean(String(this.data.search || '').trim())
    const searchMatchCategoryKeys = Array.isArray(this.data.searchMatchCategoryKeys) ? this.data.searchMatchCategoryKeys : []
    const searchMatchesCategory = categoryFilter === 'all'
      ? searchMatchCategoryKeys.length > 0
      : searchMatchCategoryKeys.includes(categoryFilter)
    this.setData({
      categoryFilter,
      ...(hasSearch && !searchMatchesCategory ? { search: '' } : {})
    })
    this.reload()
  },
  onToggleFreshShelf() {
    const freshShelfExpanded = !this.data.freshShelfExpanded
    this.setData({
      freshShelfExpanded,
      ...(freshShelfExpanded ? {} : { expandedFreshMaterialId: '' })
    })
  },
  onToggleFreshItem(event) {
    const id = event.currentTarget.dataset.id
    this.setData({ expandedFreshMaterialId: this.data.expandedFreshMaterialId === id ? '' : id })
  },
  onOpenRecipe(event) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/recipe-detail/index?id=${encodeURIComponent(id)}` })
  },
  onOpenMaterial(event) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/material-detail/index?id=${encodeURIComponent(id)}` })
  },
  onOpenRemainingEditor(event) {
    const id = event.currentTarget.dataset.id
    const item = this.data.freshShelf.find((entry) => entry.id === id)
    if (!item) return toast('没有找到这个材料')
    this.setData(buildFreshRemainingEditorState(item))
  },
  onCloseRemainingEditor() {
    this.setData({ remainingEditorOpen: false, remainingError: '' })
  },
  onRemainingAmountInput(event) {
    this.setData({ 'remainingDraft.remainingAmount': event.detail.value, remainingError: '' })
  },
  onRemainingUnitChange(event) {
    const index = Number(event.detail.value)
    const safe = Number.isInteger(index) && UNITS[index] ? index : 0
    this.setData({
      remainingUnitIndex: safe,
      'remainingDraft.remainingUnit': UNITS[safe].value,
      remainingError: ''
    })
  },
  async onSaveRemaining() {
    const result = await orchestrateFreshRemainingSave({
      repository: repository(),
      draft: this.data.remainingDraft,
      notify: toast
    })
    if (!result.saved) return this.setData({ remainingError: result.message })
    this.setData({ remainingEditorOpen: false, remainingError: '' })
    this.reload()
  },
  async onOpenLibraryCard(event) {
    const { id, name, category } = event.currentTarget.dataset
    try {
      const material = await ensureLibraryMaterial(repository(), { id, name, category })
      if (!material) throw new Error('material not found')
      wx.navigateTo({ url: `/pages/material-detail/index?id=${encodeURIComponent(material.id)}` })
    } catch (_) { toast('打开材料失败，请重试') }
  },
  onAddMaterial() { wx.navigateTo({ url: '/pages/material-edit/index' }) },
  openGlassEditor(item) {
    if (this.data.savingGlass) return
    this.setData({
      glassEditorOpen: true,
      glassEditorTitle: item ? '编辑酒杯' : '新增酒杯',
      glassError: '',
      glassForm: {
        id: item && item.id || '',
        name: item && item.name || '',
        capacityMl: item && item.capacityMl || '',
        imagePath: item && item.imagePath || '',
        notes: item && item.notes || ''
      }
    })
  },
  onAddGlassware() { this.openGlassEditor() },
  onEditGlassware(event) {
    const item = this.data.glassware.find((entry) => entry.id === event.currentTarget.dataset.id)
    if (item) this.openGlassEditor(item)
  },
  onGlassFormInput(event) { if (!this.data.savingGlass) this.setData({ [`glassForm.${event.currentTarget.dataset.field}`]: event.detail.value, glassError: '' }) },
  onCloseGlassEditor() { if (!this.data.savingGlass) this.setData({ glassEditorOpen: false, glassError: '' }) },
  async onSaveGlassware() {
    if (this.data.savingGlass) return
    const form = prepareGlasswareForSave(this.data.glassForm, this.data.glassware)
    const validation = validateGlasswareForm(form)
    if (!validation.valid) { this.setData({ glassError: validation.message }); return toast(validation.message) }
    this.setData({ savingGlass: true, glassError: '' })
    const result = await orchestrateGlasswareSave({ repository: repository(), form, notify: toast })
    this.setData({ savingGlass: false })
    if (!result.saved) return this.setData({ glassError: '保存失败，请重试' })
    this.setData({ glassEditorOpen: false })
    this.reload()
  },
  onRequestDeleteGlassware(event) {
    if (this.data.savingGlass) return
    const id = event.currentTarget.dataset.id
    const repo = repository()
    const check = orchestrateEquipmentDelete({ repository: repo, type: 'glassware', id, notify: toast })
    if (!check.needsConfirmation || typeof wx === 'undefined' || !wx.showModal) return
    const content = check.usageCount > 0
      ? `当前有 ${check.usageCount} 款酒正在使用这个酒杯。删除后，这些酒单将不再关联酒杯，且无法恢复。`
      : '删除后无法恢复。'
    wx.showModal({
      title: '删除酒杯？', content, confirmText: '删除', confirmColor: '#a54d36',
      success: async ({ confirm }) => {
        if (!confirm) return
        const result = await orchestrateGlasswareMediaDelete({ repository: repo, mediaFiles: mediaFiles(), id, confirmed: true, notify: toast, warn: toast })
        if (result.deleted) this.reload()
      }
    })
  },
  onEditMaterial(event) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/material-edit/index?id=${encodeURIComponent(id)}` })
  },
  async onToggleOwned(event) {
    const id = event.currentTarget.dataset.id
    const owned = event.currentTarget.dataset.owned !== true
    try {
      const saved = await repository().setMaterialOwned(id, owned)
      if (!saved) throw new Error('not found')
      this.reload()
    } catch (_) { toast('更新失败，请重试') }
  },
  onOpenFreshForm(event) {
    const id = event.currentTarget.dataset.id
    const item = (repository() && repository().getMaterial(id)) || null
    if (!item) return toast('没有找到这个材料')
    this.setData(buildFreshFormState(item))
  },
  onCloseFreshForm() { this.setData({ showFreshForm: false, freshError: '' }) },
  noop() {},
  onFreshAmountInput(event) { this.setData({ 'freshDraft.remainingAmount': event.detail.value, freshError: '' }) },
  onFreshUnitChange(event) {
    const index = Number(event.detail.value)
    const safe = Number.isInteger(index) && UNITS[index] ? index : 0
    this.setData({ freshUnitIndex: safe, 'freshDraft.remainingUnit': UNITS[safe].value, freshError: '' })
  },
  onFreshExpiryChange(event) { this.setData({ 'freshDraft.expiresAt': event.detail.value || '', freshError: '' }) },
  async onConfirmFresh() {
    const draft = this.data.freshDraft
    const fields = draft.trackFreshness ? { remainingUnit: draft.remainingUnit, expiresAt: draft.expiresAt || null } : {}
    if (draft.trackFreshness && String(draft.remainingAmount).trim()) fields.remainingAmount = Number(draft.remainingAmount)
    try {
      const saved = await repository().addToFreshShelf(draft.materialId, fields)
      if (!saved) throw new Error('not saved')
      this.setData({ showFreshForm: false })
      this.reload()
      toast('已加入手头鲜材')
    } catch (_) { this.setData({ freshError: '请检查余量和日期' }); toast('请检查余量和日期') }
  },
  async onUseUp(event) {
    const undo = await orchestrateFreshUseUp({ repository: repository(), materialId: event.currentTarget.dataset.id, notify: toast })
    if (!undo.removed) return
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.setData({ undo })
    this.undoTimer = setTimeout(() => this.setData({ undo: null }), 6000)
    this.reload()
  },
  async onUndoUseUp() {
    const result = await orchestrateFreshUndo({ repository: repository(), undo: this.data.undo, notify: toast })
    if (result.restored) {
      if (this.undoTimer) clearTimeout(this.undoTimer)
      this.setData({ undo: null })
      this.reload()
    }
  }
})
