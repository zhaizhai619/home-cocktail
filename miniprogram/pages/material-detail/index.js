const { UNITS } = require('../../domain/constants')
const { buildMaterialDetail, decodeMaterialId, orchestrateMaterialObservationSave } = require('./model')
const { buildFreshFormState, orchestrateFreshUseUp, orchestrateFreshUndo } = require('../materials/model')

function repository() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.repository
}
function toast(title) { if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon: 'none' }) }

Page({
  data: {
    detail: { status: 'loading' },
    units: UNITS,
    unitLabels: UNITS.map(({ label }) => label),
    showFreshForm: false,
    freshDraft: { trackFreshness: false, remainingAmount: '', remainingUnit: 'ml', expiresAt: '' },
    freshUnitIndex: 0,
    freshError: '',
    observationNote: '',
    observationError: '',
    undo: null
  },
  onLoad(query) { this.materialId = decodeMaterialId(query && query.id); this.reload() },
  onShow() { if (this.materialId) this.reload() },
  onUnload() { if (this.undoTimer) clearTimeout(this.undoTimer) },
  reload() {
    const repo = repository()
    const material = repo && this.materialId ? repo.getMaterial(this.materialId) : null
    const detail = buildMaterialDetail(material, {
      materials: repo ? repo.listMaterials() : [], recipes: repo ? repo.listRecipes() : []
    })
    this.setData({ detail })
    if (detail.status === 'ok' && wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: detail.name || '材料详情' })
  },
  onBack() { wx.navigateBack() },
  onEdit() { if (this.materialId) wx.navigateTo({ url: `/pages/material-edit/index?id=${encodeURIComponent(this.materialId)}` }) },
  onToggleOwned() {
    try {
      const saved = repository().setMaterialOwned(this.materialId, !this.data.detail.owned)
      if (!saved) throw new Error('not found')
      this.reload()
    } catch (_) { toast('更新失败，请重试') }
  },
  savePurchaseDate(value) {
    try {
      const saved = repository().setMaterialPurchasedAt(this.materialId, value || null)
      if (!saved) throw new Error('not found')
      this.reload()
    } catch (_) { toast('购买日期保存失败') }
  },
  onPurchaseDateChange(event) { this.savePurchaseDate(event.detail.value || null) },
  onClearPurchaseDate() { this.savePurchaseDate(null) },
  onObservationInput(event) { this.setData({ observationNote: event.detail.value, observationError: '' }) },
  onSaveObservation() {
    const result = orchestrateMaterialObservationSave({ repository: repository(), materialId: this.materialId, note: this.data.observationNote, notify: toast })
    if (!result.saved) {
      this.setData({ observationError: result.message })
      return
    }
    this.setData({ observationNote: '', observationError: '' })
    this.reload()
  },
  onOpenFreshForm() {
    const repo = repository()
    const item = repo && this.materialId ? repo.getMaterial(this.materialId) : null
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
      const saved = repository().addToFreshShelf(this.materialId, fields)
      if (!saved) throw new Error('not saved')
      this.setData({ showFreshForm: false })
      this.reload(); toast('已加入手头鲜材')
    } catch (_) { this.setData({ freshError: '请检查余量和日期' }); toast('请检查余量和日期') }
  },
  onUseUp() {
    const undo = orchestrateFreshUseUp({ repository: repository(), materialId: this.materialId, notify: toast })
    if (!undo.removed) return
    this.setData({ undo }); this.reload()
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.undoTimer = setTimeout(() => this.setData({ undo: null }), 6000)
  },
  onUndoUseUp() {
    const result = orchestrateFreshUndo({ repository: repository(), undo: this.data.undo, notify: toast })
    if (result.restored) { if (this.undoTimer) clearTimeout(this.undoTimer); this.setData({ undo: null }); this.reload() }
  }
})
