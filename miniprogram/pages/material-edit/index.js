const { UNITS } = require('../../domain/constants')
const { CATEGORIES, createFormDefaults, validateMaterialForm } = require('./model')
const { decodeMaterialId } = require('../material-detail/model')

const CATEGORY_OPTIONS = [
  { value: 'base-spirit', label: '常用基酒' }, { value: 'other-base-spirit', label: '其他基酒' },
  { value: 'liqueur', label: '利口酒' }, { value: 'bitters', label: '苦精' },
  { value: 'citrus', label: '柑橘汁' }, { value: 'syrup/staple', label: '糖浆/常备材料' },
  { value: 'fruit', label: '水果' }, { value: 'dairy/juice', label: '奶制品/果汁' },
  { value: 'soda/tonic', label: '气泡水/汤力水' }, { value: 'other-liquid', label: '其他液体' },
  { value: 'other-solid', label: '其他固体' }
]
const ACQUISITION_OPTIONS = [{ value: 'long-term', label: '长期材料' }, { value: 'on-demand', label: '随买随用' }]
const FORM_OPTIONS = [{ value: 'liquid', label: '液体' }, { value: 'solid', label: '固体' }]

function repository() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData.repository
}
function toast(title) { if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon: 'none' }) }
function indexFor(options, value) { const index = options.findIndex((item) => item.value === value); return index < 0 ? 0 : index }

Page({
  data: {
    mode: 'create', missing: false, form: createFormDefaults(), errors: {},
    categoryOptions: CATEGORY_OPTIONS, categoryLabels: CATEGORY_OPTIONS.map(({ label }) => label), categoryIndex: CATEGORY_OPTIONS.length - 2,
    acquisitionOptions: ACQUISITION_OPTIONS, acquisitionLabels: ACQUISITION_OPTIONS.map(({ label }) => label), acquisitionIndex: 1,
    formOptions: FORM_OPTIONS, formLabels: FORM_OPTIONS.map(({ label }) => label), formIndex: 0,
    units: UNITS, unitLabels: UNITS.map(({ label }) => label), unitIndex: 0, remainingUnitIndex: 0
  },
  onLoad(query) {
    this.materialId = decodeMaterialId(query && query.id)
    if (query && query.id && !this.materialId) return this.setData({ mode: 'edit', missing: true })
    if (!this.materialId) return
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
      categoryIndex: indexFor(CATEGORY_OPTIONS, form.category),
      acquisitionIndex: indexFor(ACQUISITION_OPTIONS, form.acquisition),
      formIndex: indexFor(FORM_OPTIONS, form.form),
      unitIndex: indexFor(UNITS, form.defaultUnit),
      remainingUnitIndex: indexFor(UNITS, form.remainingUnit)
    })
    if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: `编辑 · ${form.name}` })
  },
  onNameInput(event) { this.setData({ 'form.name': event.detail.value || '', 'errors.name': '' }) },
  onCategoryChange(event) {
    const index = Number(event.detail.value)
    const option = CATEGORY_OPTIONS[index] || CATEGORY_OPTIONS[0]
    const defaults = createFormDefaults(option.value, this.data.form.name)
    const next = { ...this.data.form, ...defaults, id: this.data.form.id, name: this.data.form.name }
    this.setData({
      form: next, categoryIndex: indexFor(CATEGORY_OPTIONS, next.category),
      acquisitionIndex: indexFor(ACQUISITION_OPTIONS, next.acquisition), formIndex: indexFor(FORM_OPTIONS, next.form),
      unitIndex: indexFor(UNITS, next.defaultUnit), remainingUnitIndex: indexFor(UNITS, next.remainingUnit), errors: {}
    })
  },
  onAcquisitionChange(event) {
    const index = Number(event.detail.value); const option = ACQUISITION_OPTIONS[index] || ACQUISITION_OPTIONS[0]
    const updates = { acquisitionIndex: indexFor(ACQUISITION_OPTIONS, option.value), 'form.acquisition': option.value }
    if (option.value === 'long-term') Object.assign(updates, { 'form.freshOnHand': false, 'form.remainingAmount': '', 'form.expiresAt': '' })
    else updates['form.owned'] = false
    this.setData(updates)
  },
  onFormChange(event) { const index = Number(event.detail.value); const option = FORM_OPTIONS[index] || FORM_OPTIONS[0]; this.setData({ formIndex: indexFor(FORM_OPTIONS, option.value), 'form.form': option.value }) },
  onUnitChange(event) { const index = Number(event.detail.value); const option = UNITS[index] || UNITS[0]; this.setData({ unitIndex: indexFor(UNITS, option.value), 'form.defaultUnit': option.value }) },
  onAlcoholicChange(event) { this.setData({ 'form.alcoholic': event.detail.value === true, 'form.abv': event.detail.value ? this.data.form.abv : '' }) },
  onAbvInput(event) { this.setData({ 'form.abv': event.detail.value, 'errors.abv': '' }) },
  onTrackChange(event) {
    const tracked = event.detail.value === true
    this.setData({ 'form.trackFreshness': tracked, 'form.assumedAvailable': tracked ? false : this.data.form.assumedAvailable })
  },
  onAssumedChange(event) { this.setData({ 'form.assumedAvailable': event.detail.value === true }) },
  onOwnedChange(event) { this.setData({ 'form.owned': event.detail.value === true }) },
  onFreshChange(event) {
    const fresh = event.detail.value === true
    this.setData({ 'form.freshOnHand': fresh, 'form.trackFreshness': fresh ? true : this.data.form.trackFreshness })
  },
  onAmountInput(event) { this.setData({ 'form.remainingAmount': event.detail.value, 'errors.remainingAmount': '' }) },
  onRemainingUnitChange(event) { const index = Number(event.detail.value); const option = UNITS[index] || UNITS[0]; this.setData({ remainingUnitIndex: indexFor(UNITS, option.value), 'form.remainingUnit': option.value }) },
  onPurchasedChange(event) { this.setData({ 'form.purchasedAt': event.detail.value || '', 'errors.date': '' }) },
  onExpiryChange(event) { this.setData({ 'form.expiresAt': event.detail.value || '', 'errors.date': '' }) },
  onSave() {
    const validation = validateMaterialForm(this.data.form)
    if (!validation.valid) { this.setData({ errors: validation.errors }); return toast('请检查标红字段') }
    try {
      const value = this.materialId ? { ...validation.value, id: this.materialId } : validation.value
      const saved = repository().saveMaterial(value)
      if (!saved) throw new Error('not saved')
      toast('材料已保存')
      wx.redirectTo({ url: `/pages/material-detail/index?id=${encodeURIComponent(saved.id)}` })
    } catch (_) { toast('保存失败，请重试') }
  },
  onDelete() {
    const repo = repository()
    const usageCount = repo ? repo.getMaterialUsageCount(this.materialId) : 0
    if (usageCount) return wx.showModal({ title: '暂时不能删除', content: `有 ${usageCount} 款酒正在使用这个材料。可以先标记为“我没有”，或从配方中移除。`, showCancel: false, confirmText: '知道了' })
    wx.showModal({
      title: '删除这个材料？', content: '删除后无法撤销，但不会删除任何酒款。', confirmText: '删除', confirmColor: '#a54d36',
      success: ({ confirm }) => {
        if (!confirm) return
        try {
          const result = repo.deleteMaterial(this.materialId)
          if (!result || !result.deleted) throw new Error('not deleted')
          toast('材料已删除'); wx.switchTab({ url: '/pages/materials/index' })
        } catch (_) { toast('删除失败，请重试') }
      }
    })
  },
  onBack() { wx.navigateBack() }
})
