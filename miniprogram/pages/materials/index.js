const { UNITS } = require('../../domain/constants')
const { buildMaterialLibrary, orchestrateFreshUseUp, orchestrateFreshUndo } = require('./model')

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'owned', label: '我有' },
  { key: 'fresh', label: '手头鲜材' },
  { key: 'missing', label: '我没有' }
]
const ACQUISITIONS = [
  { key: 'all', label: '全部类型' },
  { key: 'long-term', label: '长期材料' },
  { key: 'on-demand', label: '随买随用' }
]

function repository() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.repository
}

function toast(title) {
  if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon: 'none' })
}

Page({
  data: {
    filters: FILTERS,
    acquisitions: ACQUISITIONS,
    units: UNITS,
    unitLabels: UNITS.map(({ label }) => label),
    search: '',
    filter: 'all',
    acquisition: 'all',
    freshShelf: [],
    materials: [],
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
    const view = buildMaterialLibrary(repo ? repo.listMaterials() : [], repo ? repo.listRecipes() : [], this.data)
    this.setData(view)
  },
  onSearchInput(event) { this.setData({ search: event.detail.value || '' }); this.reload() },
  onSelectFilter(event) { this.setData({ filter: event.currentTarget.dataset.key || 'all' }); this.reload() },
  onSelectAcquisition(event) { this.setData({ acquisition: event.currentTarget.dataset.key || 'all' }); this.reload() },
  onOpenMaterial(event) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/material-detail/index?id=${encodeURIComponent(id)}` })
  },
  onAddMaterial() { wx.navigateTo({ url: '/pages/material-edit/index' }) },
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
    const unit = item.remainingUnit || item.defaultUnit || 'ml'
    const index = Math.max(0, UNITS.findIndex(({ value }) => value === unit))
    this.setData({
      showFreshForm: true,
      freshError: '',
      freshUnitIndex: index,
      freshDraft: { materialId: item.id, name: item.name, trackFreshness: item.trackFreshness === true, remainingAmount: item.remainingAmount === null ? '' : item.remainingAmount, remainingUnit: UNITS[index].value, expiresAt: item.expiresAt ? String(item.expiresAt).slice(0, 10) : '' }
    })
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
