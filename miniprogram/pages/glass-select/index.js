const { formatGlasswareLabel } = require('../../domain/equipment')
const { prepareGlasswareForSave } = require('../materials/model')
const { validateGlasswareForm, orchestrateGlasswareSave } = require('../settings/model')

function repository() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.repository
}

Page({
  data: { selectedId: '', glassware: [], orphanedSelection: false, glassEditorOpen: false, glassForm: { name: '', capacityMl: '' }, glassError: '', savingGlass: false },
  onLoad() {
    this.eventChannel = typeof this.getOpenerEventChannel === 'function' ? this.getOpenerEventChannel() : null
    if (this.eventChannel && this.eventChannel.on) {
      this.eventChannel.on('glassware:init', ({ selectedId } = {}) => {
        this.setData({ selectedId: typeof selectedId === 'string' ? selectedId : '' })
        this.reload()
      })
    }
    this.reload()
  },
  onShow() { if (this.loaded) this.reload(); else this.loaded = true },
  reload() {
    const repo = repository()
    const items = repo && repo.listGlassware ? repo.listGlassware() : []
    const selectedId = this.data.selectedId || ''
    this.setData({
      glassware: items.map((item) => ({ ...item, displayLabel: formatGlasswareLabel(item), selected: item.id === selectedId })),
      orphanedSelection: Boolean(selectedId && !items.some((item) => item.id === selectedId))
    })
  },
  onSelectGlassware(event) {
    if (this.didSelect) return
    this.didSelect = true
    const glasswareId = event.currentTarget.dataset.id || ''
    if (this.eventChannel && this.eventChannel.emit) this.eventChannel.emit('glassware:selected', { glasswareId })
    if (typeof wx !== 'undefined' && wx.navigateBack) wx.navigateBack()
  },
  onAddGlassware() { if (!this.data.savingGlass) this.setData({ glassEditorOpen: true, glassForm: { name: '', capacityMl: '' }, glassError: '' }) },
  onCloseGlassEditor() { if (!this.data.savingGlass) this.setData({ glassEditorOpen: false, glassError: '' }) },
  onGlassFormInput(event) { this.setData({ [`glassForm.${event.currentTarget.dataset.field}`]: event.detail.value, glassError: '' }) },
  onSaveGlassware() {
    if (this.data.savingGlass) return
    const form = prepareGlasswareForSave(this.data.glassForm, this.data.glassware)
    const validation = validateGlasswareForm(form)
    if (!validation.valid) return this.setData({ glassError: validation.message })
    this.setData({ savingGlass: true, glassError: '' })
    const result = orchestrateGlasswareSave({ repository: repository(), form })
    this.setData({ savingGlass: false })
    if (!result.saved) return this.setData({ glassError: '保存失败，请重试' })
    this.setData({ glassEditorOpen: false })
    this.didSelect = false
    this.onSelectGlassware({ currentTarget: { dataset: { id: result.item.id } } })
  },
  noop() {}
})
