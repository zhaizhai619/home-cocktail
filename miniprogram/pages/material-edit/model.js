const { createMaterialDefaults } = require('../../domain/material')
const { UNITS } = require('../../domain/constants')

const CATEGORIES = ['base-spirit', 'other-base-spirit', 'liqueur', 'bitters', 'citrus', 'syrup/staple', 'fruit', 'dairy/juice', 'soda/tonic', 'other-liquid', 'other-solid']
const ACQUISITIONS = ['long-term', 'on-demand']
const FORMS = ['liquid', 'solid']
const UNIT_VALUES = UNITS.map(({ value }) => value)

function validOptionalDate(value) { return !value || (typeof value === 'string' && Number.isFinite(Date.parse(value))) }

function validateMaterialForm(form = {}) {
  const errors = {}
  const name = String(form.name || '').trim()
  if (!name) errors.name = '请填写材料名称'
  if (!CATEGORIES.includes(form.category)) errors.category = '请选择有效分类'
  if (!ACQUISITIONS.includes(form.acquisition)) errors.acquisition = '请选择获取方式'
  if (!FORMS.includes(form.form)) errors.form = '请选择材料形态'
  if (!UNIT_VALUES.includes(form.defaultUnit)) errors.defaultUnit = '请选择默认单位'
  const alcoholic = form.alcoholic === true
  const hasAbv = form.abv !== null && form.abv !== undefined && String(form.abv).trim() !== ''
  const numericAbv = Number(form.abv)
  if (alcoholic && hasAbv && (!Number.isFinite(numericAbv) || numericAbv <= 0 || numericAbv > 100)) errors.abv = '酒精度需大于 0 且不超过 100'
  const freshOnHand = form.acquisition === 'on-demand' && form.freshOnHand === true
  const trackFreshness = form.trackFreshness === true
  const hasAmount = form.remainingAmount !== null && form.remainingAmount !== undefined && String(form.remainingAmount).trim() !== ''
  const remainingAmount = Number(form.remainingAmount)
  if (freshOnHand && trackFreshness && hasAmount && (!Number.isFinite(remainingAmount) || remainingAmount < 0)) errors.remainingAmount = '余量不能小于 0'
  if (freshOnHand && trackFreshness && form.remainingUnit && !UNIT_VALUES.includes(form.remainingUnit)) errors.remainingUnit = '请选择有效余量单位'
  if (freshOnHand && trackFreshness && (!validOptionalDate(form.purchasedAt) || !validOptionalDate(form.expiresAt))) errors.date = '请填写有效日期'
  if (Object.keys(errors).length) return { valid: false, value: null, errors }
  return {
    valid: true,
    value: {
      name,
      category: form.category,
      acquisition: form.acquisition,
      form: form.form,
      defaultUnit: form.defaultUnit,
      alcoholic,
      abv: alcoholic && hasAbv ? numericAbv : null,
      trackFreshness,
      assumedAvailable: trackFreshness || (form.acquisition === 'long-term' && form.owned !== true) ? false : form.assumedAvailable === true,
      owned: form.acquisition === 'long-term' && form.owned === true,
      freshOnHand,
      remainingAmount: freshOnHand && trackFreshness && hasAmount ? remainingAmount : null,
      remainingUnit: freshOnHand && trackFreshness ? (form.remainingUnit || null) : null,
      purchasedAt: freshOnHand && trackFreshness ? (form.purchasedAt || null) : null,
      expiresAt: freshOnHand && trackFreshness ? (form.expiresAt || null) : null
    },
    errors: {}
  }
}

function createFormDefaults(category = 'other-liquid', name = '') {
  const defaults = createMaterialDefaults(CATEGORIES.includes(category) ? category : 'other-liquid', name)
  return { ...defaults, remainingAmount: '', remainingUnit: defaults.defaultUnit, purchasedAt: '', expiresAt: '' }
}

function orchestrateMaterialSave({ repository, form, materialId = '', notify = () => {}, navigate = () => {} } = {}) {
  const validation = validateMaterialForm(form)
  if (!validation.valid) {
    notify(Object.values(validation.errors)[0])
    return { saved: false, item: null, form, errors: validation.errors }
  }
  try {
    const value = materialId ? { ...validation.value, id: materialId } : validation.value
    const item = repository && repository.saveMaterial(value)
    if (!item || !item.id) throw new Error('Material not saved')
    notify('材料已保存')
    navigate(item)
    return { saved: true, item, form, errors: {} }
  } catch (error) {
    const duplicate = error && error.message === 'Material already exists'
    const errors = duplicate ? { name: '同一分类下已经有这个材料' } : { form: '保存失败，请重试' }
    notify(duplicate ? '这个材料已经存在' : errors.form)
    return { saved: false, item: null, form, errors }
  }
}

module.exports = { CATEGORIES, ACQUISITIONS, FORMS, createFormDefaults, validateMaterialForm, orchestrateMaterialSave }
