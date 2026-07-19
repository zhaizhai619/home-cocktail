const { UNITS } = require('../../domain/constants')
const { buildMaterialDetail, decodeMaterialId } = require('./model')
const { orchestrateFreshUseUp, orchestrateFreshUndo } = require('../materials/model')

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
    undo: null
  },
  onLoad(query) { this.materialId = decodeMaterialId(query && query.id); this.reload() },
  onShow() { if (this.materialId) this.reload() },
  onUnload() { if (this.undoTimer) clearTimeout(this.undoTimer) },
  reload() {
    const repo = repository()
    const material = repo && this.materialId ? repo.getMaterial(this.materialId) : null
    const detail = buildMaterialDetail(material, {
      materials: repo ? repo.listMaterials() : [], recipes: repo ? repo.listRecipes() : [],
      glassware: repo ? repo.listGlassware() : [], tools: repo ? repo.listTools() : []
    })
    this.setData({ detail })
    if (detail.status === 'ok' && wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: detail.name || '材料详情' })
  },
  onBack() { wx.navigateBack() },
  onEdit() { if (this.materialId) wx.navigateTo({ url: `/pages/material-edit/index?id=${encodeURIComponent(this.materialId)}` }) },
  onOpenRecipe(event) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/recipe-detail/index?id=${encodeURIComponent(id)}` })
  },
  onToggleOwned() {
    try {
      const saved = repository().setMaterialOwned(this.materialId, !this.data.detail.owned)
      if (!saved) throw new Error('not found')
      this.reload()
    } catch (_) { toast('更新失败，请重试') }
  },
  onOpenFreshForm() {
    const item = this.data.detail
    if (item.status !== 'ok') return
    const unit = item.remainingUnit || item.defaultUnit || 'ml'
    const index = Math.max(0, UNITS.findIndex(({ value }) => value === unit))
    this.setData({ showFreshForm: true, freshUnitIndex: index, freshDraft: { trackFreshness: item.trackFreshness === true, remainingAmount: item.remainingAmount === null ? '' : item.remainingAmount, remainingUnit: UNITS[index].value, expiresAt: item.expiresAt ? String(item.expiresAt).slice(0, 10) : '' } })
  },
  onCloseFreshForm() { this.setData({ showFreshForm: false }) },
  noop() {},
  onFreshAmountInput(event) { this.setData({ 'freshDraft.remainingAmount': event.detail.value }) },
  onFreshUnitChange(event) {
    const index = Number(event.detail.value)
    const safe = Number.isInteger(index) && UNITS[index] ? index : 0
    this.setData({ freshUnitIndex: safe, 'freshDraft.remainingUnit': UNITS[safe].value })
  },
  onFreshExpiryChange(event) { this.setData({ 'freshDraft.expiresAt': event.detail.value || '' }) },
  onConfirmFresh() {
    const draft = this.data.freshDraft
    const fields = draft.trackFreshness ? { remainingUnit: draft.remainingUnit, expiresAt: draft.expiresAt || null } : {}
    if (draft.trackFreshness && String(draft.remainingAmount).trim()) fields.remainingAmount = Number(draft.remainingAmount)
    try {
      const saved = repository().addToFreshShelf(this.materialId, fields)
      if (!saved) throw new Error('not saved')
      this.setData({ showFreshForm: false })
      this.reload(); toast('已加入手头鲜材')
    } catch (_) { toast('请检查余量和日期') }
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
