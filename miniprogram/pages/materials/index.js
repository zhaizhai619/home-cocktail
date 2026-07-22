const { UNITS } = require('../../domain/constants')
const { MATERIAL_LIBRARY_TABS, buildMaterialLibrary, buildGlasswareCards, buildFreshFormState, ensureLibraryMaterial, prepareGlasswareForSave, orchestrateFreshUseUp, orchestrateFreshUndo } = require('./model')
const { validateGlasswareForm, orchestrateGlasswareSave, orchestrateEquipmentDelete, orchestrateGlasswareMediaDelete } = require('../settings/model')

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
    freshShelf: [],
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
    undo: null
  },
  onShow() { this.reload() },
  onUnload() { if (this.undoTimer) clearTimeout(this.undoTimer) },
  reload() {
    const repo = repository()
    const view = buildMaterialLibrary(repo ? repo.listMaterials() : [], repo ? repo.listRecipes() : [], { ...this.data, includeCatalog: true })
    this.setData({ ...view, glassware: buildGlasswareCards(repo ? repo.listGlassware() : []) })
  },
  onSelectBarTab(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ barTabIndex: index === 1 ? 1 : 0 })
  },
  onBarSwiperChange(event) { this.setData({ barTabIndex: Number(event.detail.current) === 1 ? 1 : 0 }) },
  onSearchInput(event) { this.setData({ search: event.detail.value || '' }); this.reload() },
  onSelectCategory(event) { this.setData({ categoryFilter: event.currentTarget.dataset.key || 'all' }); this.reload() },
  onOpenMaterial(event) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/material-detail/index?id=${encodeURIComponent(id)}` })
  },
  onOpenLibraryCard(event) {
    const { id, name, category } = event.currentTarget.dataset
    try {
      const material = ensureLibraryMaterial(repository(), { id, name, category })
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
  onSaveGlassware() {
    if (this.data.savingGlass) return
    const form = prepareGlasswareForSave(this.data.glassForm, this.data.glassware)
    const validation = validateGlasswareForm(form)
    if (!validation.valid) { this.setData({ glassError: validation.message }); return toast(validation.message) }
    this.setData({ savingGlass: true, glassError: '' })
    const result = orchestrateGlasswareSave({ repository: repository(), form, notify: toast })
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
    wx.showModal({
      title: '删除酒杯？', content: '删除后无法恢复。正在被配方使用的酒杯不能删除。', confirmText: '删除', confirmColor: '#a54d36',
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
  onToggleOwned(event) {
    const id = event.currentTarget.dataset.id
    const owned = event.currentTarget.dataset.owned !== true
    try {
      const saved = repository().setMaterialOwned(id, owned)
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
  onConfirmFresh() {
    const draft = this.data.freshDraft
    const fields = draft.trackFreshness ? { remainingUnit: draft.remainingUnit, expiresAt: draft.expiresAt || null } : {}
    if (draft.trackFreshness && String(draft.remainingAmount).trim()) fields.remainingAmount = Number(draft.remainingAmount)
    try {
      const saved = repository().addToFreshShelf(draft.materialId, fields)
      if (!saved) throw new Error('not saved')
      this.setData({ showFreshForm: false })
      this.reload()
      toast('已加入手头鲜材')
    } catch (_) { this.setData({ freshError: '请检查余量和日期' }); toast('请检查余量和日期') }
  },
  onUseUp(event) {
    const undo = orchestrateFreshUseUp({ repository: repository(), materialId: event.currentTarget.dataset.id, notify: toast })
    if (!undo.removed) return
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.setData({ undo })
    this.undoTimer = setTimeout(() => this.setData({ undo: null }), 6000)
    this.reload()
  },
  onUndoUseUp() {
    const result = orchestrateFreshUndo({ repository: repository(), undo: this.data.undo, notify: toast })
    if (result.restored) {
      if (this.undoTimer) clearTimeout(this.undoTimer)
      this.setData({ undo: null })
      this.reload()
    }
  }
})
