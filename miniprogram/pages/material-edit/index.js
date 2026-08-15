const { UNITS } = require('../../domain/constants')
const { MATERIAL_CATEGORY_GROUPS, getMaterialCategoryGroup, selectMaterialCategory } = require('../../domain/material')
const { CATEGORIES, createFormDefaults, materialSaveNavigation, orchestrateMaterialSave } = require('./model')
const { decodeMaterialId } = require('../material-detail/model')
const { waitForCloudReady } = require('../../services/page-ready')

const CATEGORY_OPTIONS = MATERIAL_CATEGORY_GROUPS.map(({ key, label }) => ({ value: key, label }))
const ACQUISITION_OPTIONS = [{ value: 'long-term', label: '长期材料' }, { value: 'on-demand', label: '随买随用' }]

function repository() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.repository
}
function toast(title, icon = 'none') { if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon }) }
function indexFor(options, value) { const index = options.findIndex((item) => item.value === value); return index < 0 ? 0 : index }
function categoryIndexFor(category) { return indexFor(CATEGORY_OPTIONS, getMaterialCategoryGroup(category).key) }
function decodeQueryValue(value) { try { return decodeURIComponent(String(value || '')) } catch (_) { return '' } }

Page({
  data: {
    mode: 'create', missing: false, savingMaterial: false, form: createFormDefaults(), errors: {},
    categoryOptions: CATEGORY_OPTIONS, categoryLabels: CATEGORY_OPTIONS.map(({ label }) => label), categoryIndex: categoryIndexFor(createFormDefaults().category),
    acquisitionOptions: ACQUISITION_OPTIONS, acquisitionLabels: ACQUISITION_OPTIONS.map(({ label }) => label), acquisitionIndex: 1,
    units: UNITS, unitLabels: UNITS.map(({ label }) => label), unitIndex: 0, remainingUnitIndex: 0
  },
  async onLoad(query) {
    await waitForCloudReady()
    this.materialId = decodeMaterialId(query && query.id)
    if (query && query.id && !this.materialId) return this.setData({ mode: 'edit', missing: true })
    if (!this.materialId) {
      const name = decodeQueryValue(query && query.name)
      const requestedCategory = decodeQueryValue(query && query.category)
      if (!name && !requestedCategory) return
      const category = CATEGORIES.includes(requestedCategory) ? requestedCategory : 'other-liquid'
      const form = createFormDefaults(category, name)
      this.setData({
        mode: 'create', form,
        categoryIndex: categoryIndexFor(form.category),
        acquisitionIndex: indexFor(ACQUISITION_OPTIONS, form.acquisition),
        unitIndex: indexFor(UNITS, form.defaultUnit),
        remainingUnitIndex: indexFor(UNITS, form.remainingUnit)
      })
      if (wx.setNavigationBarTitle && name) wx.setNavigationBarTitle({ title: `新增 · ${name}` })
      return
    }
    const material = repository() && repository().getMaterial(this.materialId)
    if (!material) return this.setData({ mode: 'edit', missing: true })
    const form = {
      ...material,
      remainingAmount: material.remainingAmount === null ? '' : material.remainingAmount,
      remainingUnit: material.remainingUnit || material.defaultUnit,
      purchasedAt: material.purchasedAt ? String(material.purchasedAt).slice(0, 10) : '',
      expiresAt: material.expiresAt ? String(material.expiresAt).slice(0, 10) : ''
    }
    this.setData({
      mode: 'edit', form,
      categoryIndex: categoryIndexFor(form.category),
      acquisitionIndex: indexFor(ACQUISITION_OPTIONS, form.acquisition),
      unitIndex: indexFor(UNITS, form.defaultUnit),
      remainingUnitIndex: indexFor(UNITS, form.remainingUnit)
    })
    if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: `编辑 · ${form.name}` })
  },
  clearFormError() { if (this.data.errors.form) this.setData({ 'errors.form': '' }) },
  onNameInput(event) { this.setData({ 'form.name': event.detail.value || '', 'errors.name': '', 'errors.form': '' }) },
  onCategoryChange(event) {
    const index = Number(event.detail.value)
    const option = CATEGORY_OPTIONS[index] || CATEGORY_OPTIONS[0]
    const category = selectMaterialCategory(this.data.form.category, option.value)
    const defaults = createFormDefaults(category, this.data.form.name)
    const next = { ...this.data.form, ...defaults, id: this.data.form.id, name: this.data.form.name }
    this.setData({
      form: next, categoryIndex: categoryIndexFor(next.category),
      acquisitionIndex: indexFor(ACQUISITION_OPTIONS, next.acquisition),
      unitIndex: indexFor(UNITS, next.defaultUnit), remainingUnitIndex: indexFor(UNITS, next.remainingUnit), errors: {}
    })
  },
  onAcquisitionChange(event) {
    this.clearFormError()
    const index = Number(event.detail.value); const option = ACQUISITION_OPTIONS[index] || ACQUISITION_OPTIONS[0]
    const wasAvailable = this.data.form.acquisition === 'on-demand' ? this.data.form.freshOnHand === true : this.data.form.owned === true
    const updates = {
      acquisitionIndex: indexFor(ACQUISITION_OPTIONS, option.value),
      'form.acquisition': option.value,
      'form.owned': option.value === 'long-term' && wasAvailable,
      'form.freshOnHand': option.value === 'on-demand' && wasAvailable
    }
    this.setData(updates)
  },
  onUnitChange(event) { this.clearFormError(); const index = Number(event.detail.value); const option = UNITS[index] || UNITS[0]; this.setData({ unitIndex: indexFor(UNITS, option.value), 'form.defaultUnit': option.value }) },
  onAlcoholicChange(event) { this.clearFormError(); this.setData({ 'form.alcoholic': event.detail.value === true, 'form.abv': event.detail.value ? this.data.form.abv : '' }) },
  onAbvInput(event) { this.setData({ 'form.abv': event.detail.value, 'errors.abv': '', 'errors.form': '' }) },
  onTrackChange(event) {
    this.clearFormError()
    const tracked = event.detail.value === true
    this.setData({ 'form.trackFreshness': tracked, 'form.assumedAvailable': tracked ? false : this.data.form.assumedAvailable })
  },
  onAssumedChange(event) { this.clearFormError(); this.setData({ 'form.assumedAvailable': event.detail.value === true }) },
  onAmountInput(event) { this.setData({ 'form.remainingAmount': event.detail.value, 'errors.remainingAmount': '', 'errors.form': '' }) },
  onRemainingUnitChange(event) { this.clearFormError(); const index = Number(event.detail.value); const option = UNITS[index] || UNITS[0]; this.setData({ remainingUnitIndex: indexFor(UNITS, option.value), 'form.remainingUnit': option.value }) },
  onPurchasedChange(event) { this.setData({ 'form.purchasedAt': event.detail.value || '', 'errors.date': '', 'errors.form': '' }) },
  onExpiryChange(event) { this.setData({ 'form.expiresAt': event.detail.value || '', 'errors.date': '', 'errors.form': '' }) },
  async onSave() {
    if (this._savingMaterial) return
    this._savingMaterial = true
    this.setData({ savingMaterial: true, 'errors.form': '' })
    let result
    try {
      result = await orchestrateMaterialSave({
        repository: repository(), form: this.data.form, materialId: this.materialId,
        notify: (message) => { if (message !== '材料已保存') toast(message) },
        navigate: () => {}
      })
      if (!result.saved) this.setData({ errors: result.errors })
    } finally {
      this._savingMaterial = false
      this.setData({ savingMaterial: false })
    }
    if (!result || !result.saved) return
    toast('保存成功', 'success')
    const target = materialSaveNavigation(this.data.mode, result.item.id)
    if (target.action === 'back') wx.navigateBack()
    else wx.redirectTo({ url: target.url })
  },
  onDelete() {
    if (this._savingMaterial) return
    const repo = repository()
    const usageCount = repo ? repo.getMaterialUsageCount(this.materialId) : 0
    if (usageCount) return wx.showModal({ title: '暂时不能删除', content: `有 ${usageCount} 款酒正在使用这个材料。可以先标记为“我没有”，或从配方中移除。`, showCancel: false, confirmText: '知道了' })
    wx.showModal({
      title: '删除这个材料？', content: '删除后无法撤销，但不会删除任何酒款。', confirmText: '删除', confirmColor: '#a54d36',
      success: async ({ confirm }) => {
        if (!confirm) return
        try {
          const result = await repo.deleteMaterial(this.materialId)
          if (!result || !result.deleted) throw new Error('not deleted')
          toast('材料已删除'); wx.switchTab({ url: '/pages/materials/index' })
        } catch (_) { toast('删除失败，请重试') }
      }
    })
  },
  onBack() { wx.navigateBack() }
})
