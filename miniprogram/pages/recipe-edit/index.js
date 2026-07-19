const { QUICK_BASE_SPIRITS, PREP_TYPES, RATINGS, UNITS } = require('../../domain/constants')
const { createEmptyRecipeForm, applyQuickBase, replaceIngredientName, createIngredientDraft, hydrateRecipeIngredient, hydrateEquipmentSelections, updateIngredientField, selectExistingIngredient, getFormPreview, orchestrateRecipeSave } = require('./model')

const NEW_CATEGORIES = [
  { key: 'base-spirit', label: '基酒' }, { key: 'other-base-spirit', label: '其他基酒' }, { key: 'liqueur', label: '利口酒' }, { key: 'bitters', label: '苦精' },
  { key: 'citrus', label: '柑橘汁' }, { key: 'syrup/staple', label: '糖浆/常备' },
  { key: 'soda/tonic', label: '苏打/汤力' }, { key: 'fruit', label: '水果' }, { key: 'other-liquid', label: '其他液体' }, { key: 'other-solid', label: '其他固体' }
]

function repository() { const app = typeof getApp === 'function' && getApp(); return app && app.globalData && app.globalData.repository }
function imageMediaFiles() { const app = typeof getApp === 'function' && getApp(); return app && app.globalData && app.globalData.mediaFiles }
function unitView(unit) { const index = UNITS.findIndex((item) => item.value === unit); return { unitIndex: index < 0 ? 0 : index, unitLabel: (UNITS[index < 0 ? 0 : index] || {}).label || 'ml' } }
function displayIngredient(row) { const categoryIndex = NEW_CATEGORIES.findIndex((item) => item.key === row.category); const category = NEW_CATEGORIES[categoryIndex < 0 ? 0 : categoryIndex]; const isExisting = Boolean(row.materialId && !row.orphanedMaterialId); const needsExistingAbvInput = isExisting && row.alcoholic === true && row.abvNeedsPersist === true; const missingExistingAbv = needsExistingAbvInput && row.abvMissing === true; return { ...row, nameLabel: row.name || '选择材料', categoryIndex: categoryIndex < 0 ? 0 : categoryIndex, categoryLabel: category.label, isExisting, canEditMetadata: !isExisting, alcoholicLabel: row.alcoholic ? '含酒精' : '不含酒精', missingExistingAbv, showAbvInput: (!isExisting && row.alcoholic === true) || needsExistingAbvInput, showAbvReadonly: isExisting && row.alcoholic === true && !needsExistingAbvInput, ...unitView(row.unit) } }
function displayPrep(row) { const units = [{ value: 'hour', label: '小时' }, { value: 'day', label: '天' }]; const index = units.findIndex((item) => item.value === row.unit); return { ...row, needsDuration: row.type !== '即调', units, unitIndex: index < 0 ? 0 : index, unitLabel: units[index < 0 ? 0 : index].label } }
function emptyData(form, glassware, tools) {
  const preview = getFormPreview(form)
  const equipment = hydrateEquipmentSelections(form, glassware, tools)
  return { form: equipment.form, glasswareOptions: equipment.glasswareOptions, glasswareIndex: equipment.glasswareIndex, glasswareLabel: equipment.glasswareLabel, tools: equipment.tools, formIngredients: equipment.form.ingredients.map(displayIngredient), formPreparations: equipment.form.preparations.map(displayPrep), preview: { ...preview, abvLabel: preview.status === 'ok' ? preview.abv : '--', missingText: (preview.missing || []).join('、'), capacity: equipment.capacity }, errors: {} }
}

Page({
  data: { quickBases: QUICK_BASE_SPIRITS, units: UNITS, prepTypes: PREP_TYPES, ratings: RATINGS, categories: NEW_CATEGORIES, materials: [], glasswareOptions: [], tools: [], suggestionOpen: false, suggestionIndex: -1, suggestions: [], savingImage: false, savingRecipe: false, imageError: '', formError: '', ...emptyData(createEmptyRecipeForm(), [], []) },
  onLoad(query) {
    const repo = repository(); const id = query && query.id; const recipe = id && repo && repo.getRecipe(id)
    this.materials = repo ? repo.listMaterials() : []; this.glassware = repo ? repo.listGlassware() : []; this.tools = repo ? repo.listTools() : []
    let form = createEmptyRecipeForm()
    if (recipe) {
      const lookup = this.materials.reduce((all, item) => { all[item.id] = item; return all }, {})
      form = { ...form, ...recipe, steps: Array.isArray(recipe.steps) ? recipe.steps.join('\n') : '', ingredients: (recipe.ingredients || []).map((row) => hydrateRecipeIngredient(row, lookup[row.materialId])) }
    }
    this.setData({ materials: this.materials, ...emptyData(form, this.glassware, this.tools) })
  },
  onShow() {
    const repo = repository()
    if (!repo || !this.data.form) return
    this.materials = repo.listMaterials(); this.glassware = repo.listGlassware(); this.tools = repo.listTools()
    this.setData({ materials: this.materials, ...emptyData(this.data.form, this.glassware, this.tools) })
  },
  sync(form, errors) { const nextErrors = errors || {}; this.setData({ ...emptyData(form, this.glassware, this.tools), errors: nextErrors, formError: nextErrors.form || '' }) },
  onBasicInput(event) { const field = event.currentTarget.dataset.field; this.sync({ ...this.data.form, [field]: event.detail.value }) },
  onTried(event) { this.sync({ ...this.data.form, tried: event.detail.value }) },
  onQuickBase(event) { this.sync(applyQuickBase(this.data.form, event.currentTarget.dataset.name)) },
  onAddIngredient(event) { const category = event.currentTarget.dataset.category || 'other-liquid'; const name = category === 'citrus' ? '青柠汁' : category === 'syrup/staple' ? '蜂蜜糖浆' : ''; this.sync({ ...this.data.form, ingredients: [...this.data.form.ingredients, createIngredientDraft(category, name)] }) },
  onIngredientChange(event) { const { index, field, value } = event.detail; const next = updateIngredientField(this.data.form, index, field, value); this.sync(next) },
  onCategoryChange(event) { const { index, category } = event.detail; const ingredients = this.data.form.ingredients.map((item, itemIndex) => itemIndex === index && !(item.materialId && !item.orphanedMaterialId) ? { ...createIngredientDraft(category, item.name), amount: item.amount, observation: item.observation || '' } : item); this.sync({ ...this.data.form, ingredients }) },
  onAlcoholicChange(event) { const { index, value } = event.detail; const ingredients = this.data.form.ingredients.map((item, itemIndex) => itemIndex === index && !(item.materialId && !item.orphanedMaterialId) ? { ...item, alcoholic: value, abv: value ? item.abv : null } : item); this.sync({ ...this.data.form, ingredients }) },
  onRemoveIngredient(event) { const index = event.detail.index; const ingredients = this.data.form.ingredients.filter((_, itemIndex) => itemIndex !== index); this.sync({ ...this.data.form, ingredients }) },
  onPickName(event) {
    const index = event.detail.index
    this.setData({ suggestionOpen: true, suggestionIndex: index, suggestionQuery: '', suggestions: this.suggestionsFor(index, '') })
  },
  suggestionsFor(index, query) {
    const ingredient = this.data.form.ingredients[index] || {}; const common = ingredient.category === 'citrus' ? ['柠檬汁', '青柠汁'] : ingredient.category === 'syrup/staple' ? ['糖浆', '蜂蜜糖浆', '肉桂糖浆'] : []
    const normalized = String(query || '').trim().toLowerCase()
    return [...common.map((name) => ({ name, category: ingredient.category, kind: 'replace' })), ...this.materials.map((item) => ({ ...item, kind: 'existing' }))].filter((item) => !normalized || String(item.name || '').toLowerCase().includes(normalized))
  },
  onSuggestionInput(event) { const suggestionQuery = event.detail.value || ''; this.setData({ suggestionQuery, suggestions: this.suggestionsFor(this.data.suggestionIndex, suggestionQuery) }) },
  closeSuggestions() { this.setData({ suggestionOpen: false }) },
  onChooseSuggestion(event) {
    const option = this.data.suggestions[event.currentTarget.dataset.index]; const index = this.data.suggestionIndex; if (!option || index < 0) return this.closeSuggestions()
    const ingredients = this.data.form.ingredients.slice(); const next = option.kind === 'existing' ? selectExistingIngredient(this.data.form, index, option) : { ...this.data.form, ingredients: replaceIngredientName({ ...this.data.form, ingredients }, index, option.name).ingredients }
    this.sync(next); this.closeSuggestions()
  },
  onTogglePrep(event) {
    const type = event.detail.type; const existing = this.data.form.preparations || []; let preparations
    if (type === '即调') preparations = [{ type, amount: '', unit: 'hour', note: '' }]
    else { preparations = existing.filter((item) => item.type !== '即调'); preparations = preparations.some((item) => item.type === type) ? preparations.filter((item) => item.type !== type) : [...preparations, { type, amount: '', unit: 'hour', note: '' }] }
    this.sync({ ...this.data.form, preparations })
  },
  onPrepChange(event) { const { index, field, value } = event.detail; const preparations = this.data.form.preparations.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item); this.sync({ ...this.data.form, preparations }) },
  onGlassware(event) { const option = this.data.glasswareOptions[Number(event.detail.value)]; this.sync({ ...this.data.form, glasswareId: option ? option.id : '' }) },
  onTools(event) { const indexes = event.detail.value || []; this.sync({ ...this.data.form, toolIds: indexes.map((index) => this.data.tools[Number(index)]).filter(Boolean).map((tool) => tool.id) }) },
  onRating(event) { this.sync({ ...this.data.form, rating: event.currentTarget.dataset.rating }) },
  noop() {},
  onChooseImage() {
    if (this.data.savingImage || typeof wx === 'undefined' || !wx.chooseMedia) return
    wx.chooseMedia({ count: 1, mediaType: ['image'], success: async (result) => {
      const selected = result.tempFiles && result.tempFiles[0] && result.tempFiles[0].tempFilePath
      if (!selected) return
      this.setData({ savingImage: true, imageError: '' })
      try {
        const mediaFiles = imageMediaFiles()
        if (!mediaFiles || typeof mediaFiles.persistRecipeImage !== 'function') throw new Error('media unavailable')
        const persisted = await mediaFiles.persistRecipeImage(selected)
        this.sync({ ...this.data.form, imagePath: persisted.path })
      } catch (_) {
        this.setData({ imageError: '图片保存失败，请重新选择' })
        wx.showToast({ title: '图片保存失败，请重试', icon: 'none' })
      } finally { this.setData({ savingImage: false }) }
    } })
  },
  onSave() {
    if (this.data.savingImage) return wx.showToast({ title: '图片处理中，请稍候', icon: 'none' })
    if (this._savingRecipe) return
    this._savingRecipe = true
    this.setData({ savingRecipe: true, formError: '' })
    const result = orchestrateRecipeSave({ repository: repository(), form: this.data.form, notify: (title) => { if (typeof wx !== 'undefined') wx.showToast({ title, icon: 'none' }) }, navigateBack: () => { if (typeof wx !== 'undefined' && wx.navigateBack) wx.navigateBack() } })
    if (!result.saved) {
      this._savingRecipe = false
      this.setData({ savingRecipe: false })
      if (Object.keys(result.errors).length) this.sync(result.form, result.errors)
    }
  }
})
