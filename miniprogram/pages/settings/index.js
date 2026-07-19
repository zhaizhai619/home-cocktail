const {
  buildSettingsView,
  orchestrateGlasswareMediaSave,
  orchestrateToolSave,
  orchestrateEquipmentDelete,
  orchestrateGlasswareMediaDelete,
  createEditorOperationGuard
} = require('./model')

function getRepository() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.repository
}

function getMediaFiles() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.mediaFiles
}

function toast(title) {
  if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon: 'none' })
}

Page({
  data: {
    view: { glassware: [], builtInTools: [], customTools: [] },
    editorOpen: false,
    editorType: '',
    editorTitle: '',
    form: {},
    selectedImagePath: '',
    imagePreviewPath: '',
    savingGlass: false
  },
  onShow() { this.loadData() },
  loadData() {
    const repository = getRepository()
    this.setData({
      view: buildSettingsView(
        repository ? repository.listGlassware() : [],
        repository ? repository.listTools() : [],
        repository ? repository.listRecipes() : []
      )
    })
  },
  operationGuard() {
    if (!this._editorOperationGuard) this._editorOperationGuard = createEditorOperationGuard()
    return this._editorOperationGuard
  },
  editorMutationAllowed() { return this.savingGlass !== true && this.operationGuard().canMutateEditor() },
  openEditor(type, item) {
    if (!this.editorMutationAllowed()) return
    const isGlassware = type === 'glassware'
    this.setData({
      editorOpen: true,
      editorType: type,
      editorTitle: `${item ? '编辑' : '新增'}${isGlassware ? '杯具' : '自定义用具'}`,
      selectedImagePath: isGlassware && item && item.imagePath || '',
      imagePreviewPath: isGlassware && item && item.imagePath || '',
      form: isGlassware
        ? { id: item && item.id || '', name: item && item.name || '', capacityMl: item && item.capacityMl || '', imagePath: item && item.imagePath || '', notes: item && item.notes || '' }
        : { id: item && item.id || '', name: item && item.name || '' }
    })
  },
  onAddGlassware() { this.openEditor('glassware') },
  onEditGlassware(event) {
    const item = this.data.view.glassware.find((entry) => entry.id === event.currentTarget.dataset.id)
    if (item) this.openEditor('glassware', item)
  },
  onAddTool() { this.openEditor('tool') },
  onEditTool(event) {
    const item = this.data.view.customTools.find((entry) => entry.id === event.currentTarget.dataset.id)
    if (item) this.openEditor('tool', item)
  },
  onFormInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }) },
  onChooseGlassImage() {
    if (typeof wx === 'undefined' || !wx.chooseMedia) return
    wx.chooseMedia({ count: 1, mediaType: ['image'], success: (result) => {
      const file = result.tempFiles && result.tempFiles[0]
      if (file) this.setData({ selectedImagePath: file.tempFilePath, imagePreviewPath: file.tempFilePath })
    } })
  },
  onRemoveGlassImage() { this.setData({ selectedImagePath: '', imagePreviewPath: '' }) },
  closeEditor() { if (this.editorMutationAllowed()) this.setData({ editorOpen: false }) },
  closeEditorAfterSave() { this.setData({ editorOpen: false }) },
  noop() {},
  async onSaveEditor() {
    if (this.savingGlass === true) return
    const options = { repository: getRepository(), form: this.data.form, notify: toast }
    if (this.data.editorType !== 'glassware') {
      const result = orchestrateToolSave(options)
      if (result.saved) { this.closeEditor(); this.loadData() }
      return
    }
    const guard = this.operationGuard()
    const token = guard.begin()
    if (!token) return
    this.savingGlass = true
    this.setData({ savingGlass: true })
    let result = { saved: false }
    let isCurrent = false
    try {
      result = await orchestrateGlasswareMediaSave({ ...options, mediaFiles: getMediaFiles(), selectedImagePath: this.data.selectedImagePath, warn: toast })
    } finally {
      isCurrent = guard.isCurrent(token)
      if (isCurrent) {
        guard.finish(token)
        this.savingGlass = false
        this.setData({ savingGlass: false })
      }
    }
    if (result.saved && isCurrent) { this.closeEditorAfterSave(); this.loadData() }
  },
  requestDelete(type, id) {
    if (!this.editorMutationAllowed()) return
    const repository = getRepository()
    const check = orchestrateEquipmentDelete({ repository, type, id, notify: toast })
    if (!check.needsConfirmation || typeof wx === 'undefined' || !wx.showModal) return
    wx.showModal({
      title: `删除${type === 'glassware' ? '杯具' : '用具'}？`,
      content: '删除后无法恢复。未被酒款使用时才可删除。',
      confirmText: '删除', confirmColor: '#a54d36',
      success: async ({ confirm }) => {
        if (!confirm) return
        const result = type === 'glassware'
          ? await orchestrateGlasswareMediaDelete({ repository, mediaFiles: getMediaFiles(), id, confirmed: true, notify: toast, warn: toast })
          : orchestrateEquipmentDelete({ repository, type, id, confirmed: true, notify: toast })
        if (result.deleted) this.loadData()
      }
    })
  },
  onRequestDeleteGlassware(event) { this.requestDelete('glassware', event.currentTarget.dataset.id) },
  onRequestDeleteTool(event) { this.requestDelete('tool', event.currentTarget.dataset.id) }
})
