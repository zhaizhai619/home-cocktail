const { UNITS } = require('../../domain/constants')
const {
  buildMaterialDetail,
  decodeMaterialId,
  orchestrateMaterialObservationSave,
  orchestrateMaterialObservationUpdate,
  orchestrateMaterialObservationDelete
} = require('./model')
const { buildFreshFormState, orchestrateFreshUseUp, orchestrateFreshUndo } = require('../materials/model')

function repository() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.repository
}
function toast(title) { if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon: 'none' }) }
function touchPoint(touch) {
  return {
    x: Number(touch && (touch.clientX ?? touch.pageX)) || 0,
    y: Number(touch && (touch.clientY ?? touch.pageY)) || 0
  }
}

Page({
  data: {
    detail: { status: 'loading' },
    units: UNITS,
    unitLabels: UNITS.map(({ label }) => label),
    freshDraft: { trackFreshness: false, remainingAmount: '', remainingUnit: 'ml', expiresAt: '' },
    freshUnitIndex: 0,
    freshError: '',
    showObservationForm: false,
    observationNote: '',
    observationError: '',
    editingObservation: null,
    openObservationKey: '',
    undo: null
  },
  onLoad(query) {
    this.materialId = decodeMaterialId(query && query.id)
    this.reload()
    const app = typeof getApp === 'function' ? getApp() : null
    const ready = app && app.globalData && app.globalData.ready
    if (ready && typeof ready.then === 'function') ready.then(() => { if (this.materialId) this.reload() })
  },
  onShow() {
    if (this.hasShown) {
      if (this.materialId) this.reload()
    } else this.hasShown = true
  },
  onUnload() { if (this.undoTimer) clearTimeout(this.undoTimer) },
  reload() {
    const repo = repository()
    const material = repo && this.materialId ? repo.getMaterial(this.materialId) : null
    const detail = buildMaterialDetail(material, {
      materials: repo ? repo.listMaterials() : [], recipes: repo ? repo.listRecipes() : []
    })
    const trackingState = buildFreshFormState(material || {})
    this.setData({
      detail,
      freshDraft: trackingState.freshDraft,
      freshUnitIndex: trackingState.freshUnitIndex,
      freshError: '',
      openObservationKey: ''
    })
    if (detail.status === 'ok' && wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: detail.name || '材料详情' })
  },
  onBack() { wx.navigateBack() },
  onEdit() { if (this.materialId) wx.navigateTo({ url: `/pages/material-edit/index?id=${encodeURIComponent(this.materialId)}` }) },
  async onToggleAvailable(event) {
    try {
      const saved = await repository().setMaterialAvailable(this.materialId, event.detail.value === true)
      if (!saved) throw new Error('not found')
      this.reload()
    } catch (_) { toast('更新失败，请重试') }
  },
  async onToggleTracking(event) {
    try {
      const saved = await repository().setMaterialTracking(this.materialId, event.detail.value === true)
      if (!saved) throw new Error('not found')
      this.reload()
    } catch (_) { toast('更新失败，请重试') }
  },
  async savePurchaseDate(value) {
    try {
      const saved = await repository().setMaterialPurchasedAt(this.materialId, value || null)
      if (!saved) throw new Error('not found')
      this.reload()
    } catch (_) { toast('购买日期保存失败') }
  },
  async onPurchaseDateChange(event) { await this.savePurchaseDate(event.detail.value || null) },
  async onClearPurchaseDate() { await this.savePurchaseDate(null) },
  onOpenObservation() {
    this.setData({
      showObservationForm: true,
      observationNote: '',
      observationError: '',
      editingObservation: null,
      openObservationKey: ''
    })
  },
  onCancelObservation() {
    this.setData({
      showObservationForm: false,
      observationNote: '',
      observationError: '',
      editingObservation: null,
      openObservationKey: ''
    })
  },
  onObservationInput(event) { this.setData({ observationNote: event.detail.value, observationError: '' }) },
  async onSaveObservation() {
    const editing = this.data.editingObservation
    const result = await (editing
      ? orchestrateMaterialObservationUpdate({
        repository: repository(),
        materialId: this.materialId,
        recipeId: editing.recipeId,
        direct: editing.direct,
        observationIndex: editing.observationIndex,
        note: this.data.observationNote,
        notify: toast
      })
      : orchestrateMaterialObservationSave({
        repository: repository(),
        materialId: this.materialId,
        note: this.data.observationNote,
        notify: toast
      }))
    if (!result.saved) {
      this.setData({ observationError: result.message })
      return
    }
    this.setData({
      observationNote: '',
      observationError: '',
      showObservationForm: false,
      editingObservation: null,
      openObservationKey: ''
    })
    this.reload()
  },
  onEditObservation(event) {
    const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
    this.setData({
      showObservationForm: true,
      observationNote: String(dataset.note || ''),
      observationError: '',
      editingObservation: {
        renderKey: String(dataset.key || ''),
        direct: dataset.direct === true || dataset.direct === 'true',
        recipeId: dataset.recipeId || '',
        observationIndex: Number(dataset.index)
      },
      openObservationKey: ''
    })
  },
  onObservationTouchStart(event) {
    const touch = event && event.touches && event.touches[0]
    this._observationTouch = {
      key: String(event && event.currentTarget && event.currentTarget.dataset.key || ''),
      ...touchPoint(touch)
    }
  },
  onObservationTouchEnd(event) {
    const start = this._observationTouch
    const key = String(event && event.currentTarget && event.currentTarget.dataset.key || '')
    const end = touchPoint(event && event.changedTouches && event.changedTouches[0])
    this._observationTouch = null
    if (!start || !key || start.key !== key) return
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return
    this.setData({ openObservationKey: deltaX < 0 ? key : '' })
  },
  async onDeleteObservation(event) {
    const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
    const result = await orchestrateMaterialObservationDelete({
      repository: repository(),
      materialId: this.materialId,
      recipeId: dataset.recipeId || '',
      direct: dataset.direct === true || dataset.direct === 'true',
      observationIndex: Number(dataset.index),
      notify: toast
    })
    if (result.deleted) this.reload()
  },
  async saveTrackingFields(fields) {
    try {
      const saved = await repository().updateMaterialInventory(this.materialId, fields)
      if (!saved) throw new Error('not saved')
      this.reload()
    } catch (_) {
      this.setData({ freshError: '请检查剩余量和日期' })
      toast('请检查剩余量和日期')
    }
  },
  onTrackingAmountInput(event) {
    this.setData({ 'freshDraft.remainingAmount': event.detail.value, freshError: '' })
  },
  async onTrackingAmountBlur(event) {
    const raw = String((event.detail && event.detail.value) ?? this.data.freshDraft.remainingAmount).trim()
    if (!raw) return this.saveTrackingFields({ remainingAmount: null, remainingUnit: null })
    await this.saveTrackingFields({ remainingAmount: Number(raw), remainingUnit: this.data.freshDraft.remainingUnit })
  },
  async onTrackingUnitChange(event) {
    const index = Number(event.detail.value)
    const safe = Number.isInteger(index) && UNITS[index] ? index : 0
    this.setData({ freshUnitIndex: safe, 'freshDraft.remainingUnit': UNITS[safe].value, freshError: '' })
    const raw = String(this.data.freshDraft.remainingAmount).trim()
    if (raw) await this.saveTrackingFields({ remainingAmount: Number(raw), remainingUnit: UNITS[safe].value })
  },
  async onTrackingExpiryChange(event) {
    const expiresAt = event.detail.value || ''
    this.setData({ 'freshDraft.expiresAt': expiresAt, freshError: '' })
    await this.saveTrackingFields({ expiresAt: expiresAt || null })
  },
  async onUseUp() {
    const undo = await orchestrateFreshUseUp({ repository: repository(), materialId: this.materialId, notify: toast })
    if (!undo.removed) return
    this.setData({ undo }); this.reload()
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.undoTimer = setTimeout(() => this.setData({ undo: null }), 6000)
  },
  async onUndoUseUp() {
    const result = await orchestrateFreshUndo({ repository: repository(), undo: this.data.undo, notify: toast })
    if (result.restored) { if (this.undoTimer) clearTimeout(this.undoTimer); this.setData({ undo: null }); this.reload() }
  }
})
