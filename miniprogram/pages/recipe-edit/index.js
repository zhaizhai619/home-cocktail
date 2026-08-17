const { PREP_ENTRY_TYPES, RATINGS, UNITS, RECIPE_UNITS } = require('../../domain/constants')
const { formatPreparationDurationText, getPreparationDurationParts } = require('../../domain/recipe')
const { getMaterialCategoryGroup, getMaterialDisplayName, getMaterialIdentityKey, materialNameMatchesQuery } = require('../../domain/material')
const { createEmptyRecipeForm, applyMaterialSelection, reorderIngredient, createAdvancePreparation, updateAdvancePreparation, applyAdvanceMaterialSelection, removeAdvancePreparation, hydrateRecipeIngredient, hydrateEquipmentSelections, updateTriedState, updateIngredientField, normalizeAndValidateForm, buildAiNamingInput, getFormPreview, getMissingAlcoholAbvHint, orchestrateRecipeSave } = require('./model')
const { waitForCloudReady } = require('../../services/page-ready')

const NEW_CATEGORIES = [
  { key: 'base-spirit', label: '基酒' }, { key: 'other-base-spirit', label: '其他基酒' }, { key: 'liqueur', label: '利口酒' }, { key: 'bitters', label: '苦精' },
  { key: 'citrus', label: '柑橘汁' }, { key: 'syrup/staple', label: '糖浆/常备' },
  { key: 'soda/tonic', label: '苏打/汤力' }, { key: 'fruit', label: '水果' }, { key: 'dairy/juice', label: '奶制品/果汁' },
  { key: 'other-liquid', label: '其他液体' }, { key: 'other-solid', label: '其他固体' }, { key: 'other', label: '其他' }
]

const MATERIAL_SHORTCUTS = [
  { key: 'base', label: '基酒' },
  { key: 'liqueur', label: '利口酒' },
  { key: 'produce', label: '果汁/果蔬' },
  { key: 'mixer', label: '混合饮品' },
  { key: 'spice', label: '香料' },
  { key: 'all', label: '材料库' }
]

const AI_FEEDBACK_OPTIONS = [
  { key: 'vibe_mismatch', label: '氛围不匹配' },
  { key: 'weak_reason', label: '理由太牵强' },
  { key: 'bad_name', label: '歌名不像酒名' }
]

function categoryFilterForIngredient(row) {
  return row && row.category ? getMaterialCategoryGroup(row.category).key : 'all'
}

function repository() { const app = typeof getApp === 'function' && getApp(); return app && app.globalData && app.globalData.repository }
function appServices() { const app = typeof getApp === 'function' && getApp(); return app && app.globalData ? app.globalData : {} }
function showAiNamingPrompt({ title, content, confirmText = '去完善', onConfirm } = {}) {
  if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') return
  wx.showModal({
    title,
    content,
    confirmText,
    cancelText: '暂不',
    success: ({ confirm }) => { if (confirm && typeof onConfirm === 'function') onConfirm() }
  })
}
function promptSongImport(page) {
  showAiNamingPrompt({
    title: '先导入歌曲',
    content: '还没有可用于起名的歌曲，请先导入并解析喜欢的歌曲。',
    onConfirm: () => {
      if (page && typeof page.setData === 'function') page.setData({ aiNamingOpen: false })
      if (typeof wx !== 'undefined' && typeof wx.navigateTo === 'function') wx.navigateTo({ url: '/pages/music-naming/index' })
    }
  })
}
function unitView(unit) { const index = RECIPE_UNITS.findIndex((item) => item.value === unit); const legacy = UNITS.find((item) => item.value === unit); return { unitIndex: index < 0 ? 0 : index, unitLabel: (index < 0 ? legacy : RECIPE_UNITS[index] || {}).label || 'ml' } }
function displayIngredient(row) {
  if (row && row.kind === 'prepared-output') return { ...row, nameLabel: row.name || '预调成品', isPrepared: true, ...unitView(row.unit) }
  const categoryIndex = NEW_CATEGORIES.findIndex((item) => item.key === row.category); const category = NEW_CATEGORIES[categoryIndex < 0 ? 0 : categoryIndex]; const isExisting = Boolean(row.materialId && !row.orphanedMaterialId); const needsExistingAbvInput = isExisting && row.alcoholic === true && row.abvNeedsPersist === true; const missingExistingAbv = needsExistingAbvInput && row.abvMissing === true
  return { ...row, nameLabel: row.name || '选择材料', categoryIndex: categoryIndex < 0 ? 0 : categoryIndex, categoryLabel: category.label, isExisting, canEditMetadata: !isExisting, alcoholicLabel: row.alcoholic ? '含酒精' : '不含酒精', missingExistingAbv, showAbvInput: (!isExisting && row.alcoholic === true) || needsExistingAbvInput, showAbvReadonly: isExisting && row.alcoholic === true && !needsExistingAbvInput, ...unitView(row.unit) }
}
function displayPrep(row) {
  const units = [{ value: 'hour', label: '小时' }, { value: 'day', label: '天' }]
  const duration = getPreparationDurationParts(row)
  const durationUnit = units.some(({ value }) => value === row.durationUnit) ? row.durationUnit : duration.unit
  const unitIndex = Math.max(0, units.findIndex(({ value }) => value === durationUnit))
  return { ...row, needsDuration: row.type !== '即调', durationValue: duration.value, durationUnit: units[unitIndex].value, durationUnitLabel: units[unitIndex].label, units, unitIndex }
}
function prepTypeOptions(preparations) {
  const selected = new Set((Array.isArray(preparations) ? preparations : []).map((item) => item.type))
  return PREP_ENTRY_TYPES.map((type) => ({ type, selected: selected.has(type) }))
}
function emptyData(form, glassware, tools) {
  const preview = getFormPreview(form)
  const equipment = hydrateEquipmentSelections(form, glassware, tools)
  const advanceCards = equipment.form.advancePreparations.map((preparation) => ({ ...preparation, formIngredients: preparation.ingredients.map(displayIngredient) }))
  return { form: equipment.form, glasswareOptions: equipment.glasswareOptions, glasswareIndex: equipment.glasswareIndex, glasswareLabel: equipment.glasswareLabel, tools: equipment.tools, formIngredients: equipment.form.ingredients.map(displayIngredient), advanceCards, formPreparations: equipment.form.preparations.map(displayPrep), prepTypeOptions: prepTypeOptions(equipment.form.preparations), preview: { ...preview, abvLabel: preview.status === 'ok' ? preview.abv : '--', abvHint: getMissingAlcoholAbvHint(form), missingText: (preview.missing || []).join('、'), capacity: equipment.capacity }, errors: {} }
}

Page({
  data: { units: RECIPE_UNITS, ratings: RATINGS, categories: NEW_CATEGORIES, addCategories: MATERIAL_SHORTCUTS, materials: [], glasswareOptions: [], tools: [], materialStage: 'serving', draggingIngredientIndex: -1, draggingAdvanceIndex: -1, draggingAdvancePreparationId: '', savingRecipe: false, formError: '', aiNamingOpen: false, aiColor: '', aiPreference: '', aiThinking: false, aiThinkingText: 'AI 思考中…', aiError: '', aiNeedsSetup: false, aiRecommendations: [], aiCocktailProfile: null, aiExcludedSongIds: [], aiFeedbackSongId: '', aiFeedbackTags: [], aiFeedbackNote: '', aiFeedbackError: '', aiFeedbackSubmitting: false, aiFeedbackOptions: AI_FEEDBACK_OPTIONS.map((item) => ({ ...item, selected: false })), ...emptyData(createEmptyRecipeForm(), [], []) },
  async onLoad(query) {
    await waitForCloudReady()
    const repo = repository(); const id = query && query.id; const recipe = id && repo && repo.getRecipe(id)
    this.materials = repo ? repo.listMaterials() : []; this.glassware = repo ? repo.listGlassware() : []; this.tools = repo ? repo.listTools() : []
    let form = createEmptyRecipeForm()
    if (recipe) {
      const lookup = this.materials.reduce((all, item) => { all[item.id] = item; return all }, {})
      const advancePreparations = (Array.isArray(recipe.advancePreparations) ? recipe.advancePreparations : []).map((preparation) => ({ ...preparation, steps: Array.isArray(preparation.steps) ? preparation.steps.join('\n') : '', ingredients: (preparation.ingredients || []).map((row) => hydrateRecipeIngredient(row, lookup[row.materialId])) }))
      const preparationsById = advancePreparations.reduce((all, preparation) => { all[preparation.id] = preparation; return all }, {})
      form = { ...form, ...recipe, steps: Array.isArray(recipe.steps) ? recipe.steps.join('\n') : '', advancePreparations, ingredients: (recipe.ingredients || []).map((row) => hydrateRecipeIngredient(row, lookup[row.materialId], preparationsById[row.preparationId])) }
    }
    this.setData({ materials: this.materials, ...emptyData(form, this.glassware, this.tools) })
  },
  async onShow() {
    await waitForCloudReady()
    this._openingGlassSelect = false
    this._openingMaterialSelect = false
    const repo = repository()
    if (!repo || !this.data.form) return
    this.materials = repo.listMaterials(); this.glassware = repo.listGlassware(); this.tools = repo.listTools()
    this.setData({ materials: this.materials, ...emptyData(this.data.form, this.glassware, this.tools), errors: this.data.errors || {}, formError: this.data.formError || '' })
  },
  sync(form, errors) { const nextErrors = errors || {}; this.setData({ ...emptyData(form, this.glassware, this.tools), errors: nextErrors, formError: nextErrors.form || '' }) },
  onBasicInput(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    this.sync({ ...this.data.form, [field]: value })
  },
  async onOpenAiNaming() {
    const validation = normalizeAndValidateForm(this.data.form)
    const materialError = validation.errors.ingredients || validation.errors.advancePreparation
    if (materialError) {
      showAiNamingPrompt({
        title: '先完善配方',
        content: '请先填写完整的材料和用量，再使用 AI 起名。',
        onConfirm: () => {
          if (typeof wx !== 'undefined' && typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ selector: '.ingredient-section', duration: 300 })
        }
      })
      return
    }
    const { musicAssistant } = appServices()
    if (musicAssistant && typeof musicAssistant.getStatus === 'function') {
      try {
        const status = await musicAssistant.getStatus()
        if (Number(status && status.analyzedCount) <= 0) return promptSongImport(this)
      } catch (error) {
        if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') wx.showToast({ title: error.message || '暂时无法检查歌曲，请稍后重试', icon: 'none' })
        return
      }
    }
    this.setData({ aiNamingOpen: true, aiError: '', aiNeedsSetup: false, aiRecommendations: [], aiCocktailProfile: null, aiExcludedSongIds: [], aiFeedbackSongId: '', aiFeedbackTags: [], aiFeedbackNote: '', aiFeedbackError: '', aiFeedbackOptions: AI_FEEDBACK_OPTIONS.map((item) => ({ ...item, selected: false })), aiThinkingText: 'AI 思考中…' })
  },
  onCloseAiNaming() { if (!this.data.aiThinking) this.setData({ aiNamingOpen: false }) },
  onAiFieldInput(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }) },
  onOpenMusicSettings() { wx.navigateTo({ url: '/pages/music-naming/index' }) },
  async onGenerateAiNames() {
    if (this.data.aiThinking) return
    const { musicAssistant, musicAssistantSettings } = appServices()
    if (!musicAssistant || !musicAssistantSettings) return this.setData({ aiError: '智能起名服务不可用' })
    const settings = musicAssistantSettings.load()
    if (!settings.apiKey) return this.setData({ aiError: '请先在体验版页面填写 DeepSeek API Key', aiNeedsSetup: true })
    const cocktailInput = buildAiNamingInput(this.data.form)
    if (!cocktailInput.ingredients.length && !cocktailInput.advancePreparations.length) return this.setData({ aiError: '请先添加至少一种材料，AI 才能理解这杯酒' })
    this.setData({ aiThinking: true, aiThinkingText: 'AI 思考中…', aiError: '', aiNeedsSetup: false, aiRecommendations: [] })
    const thinkingTimer = setTimeout(() => this.setData({ aiThinkingText: '深度思考中…' }), 900)
    try {
      const result = await musicAssistant.recommendNames({
        apiKey: settings.apiKey,
        model: settings.model,
        color: this.data.aiColor,
        preference: this.data.aiPreference,
        excludeSongIds: this.data.aiExcludedSongIds || [],
        ...cocktailInput
      })
      this.setData({ aiRecommendations: result.recommendations || [], aiCocktailProfile: result.cocktailProfile || null, aiFeedbackSongId: '', aiFeedbackTags: [], aiFeedbackNote: '', aiFeedbackError: '', aiFeedbackOptions: AI_FEEDBACK_OPTIONS.map((item) => ({ ...item, selected: false })) })
    } catch (error) {
      if (error && error.code === 'NO_SONG_PROFILES') {
        this.setData({ aiError: '' })
        promptSongImport(this)
      } else this.setData({ aiError: error.message || '暂时没有生成合适的名字' })
    } finally {
      clearTimeout(thinkingTimer)
      this.setData({ aiThinking: false })
    }
  },
  onOpenAiFeedback(event) {
    const songId = String(event.currentTarget.dataset.songId || '')
    this.setData({ aiFeedbackSongId: songId, aiFeedbackTags: [], aiFeedbackNote: '', aiFeedbackError: '', aiFeedbackOptions: AI_FEEDBACK_OPTIONS.map((item) => ({ ...item, selected: false })) })
  },
  onToggleAiFeedbackTag(event) {
    const tag = String(event.currentTarget.dataset.tag || '')
    if (!AI_FEEDBACK_OPTIONS.some((item) => item.key === tag)) return
    const current = new Set(this.data.aiFeedbackTags || [])
    if (current.has(tag)) current.delete(tag)
    else current.add(tag)
    const tags = [...current]
    this.setData({ aiFeedbackTags: tags, aiFeedbackError: '', aiFeedbackOptions: AI_FEEDBACK_OPTIONS.map((item) => ({ ...item, selected: current.has(item.key) })) })
  },
  onAiFeedbackNoteInput(event) { this.setData({ aiFeedbackNote: event.detail.value }) },
  async onSubmitAiFeedback() {
    if (this.data.aiFeedbackSubmitting) return
    const songId = String(this.data.aiFeedbackSongId || '')
    const tags = this.data.aiFeedbackTags || []
    if (!tags.length) return this.setData({ aiFeedbackError: '请至少选择一个原因' })
    const recommendation = (this.data.aiRecommendations || []).find((item) => String(item.song_id || '') === songId)
    const { musicAssistant, musicAssistantSettings } = appServices()
    if (!recommendation || !musicAssistant || typeof musicAssistant.submitNamingFeedback !== 'function') return this.setData({ aiFeedbackError: '反馈服务暂不可用' })
    const settings = musicAssistantSettings && musicAssistantSettings.load ? musicAssistantSettings.load() : {}
    this.setData({ aiFeedbackSubmitting: true, aiFeedbackError: '' })
    try {
      await musicAssistant.submitNamingFeedback({
        songId,
        title: recommendation.recommended_name,
        artist: recommendation.artist,
        feedbackAction: 'rejected',
        tags,
        note: this.data.aiFeedbackNote,
        reason: recommendation.reason,
        cocktailProfile: this.data.aiCocktailProfile,
        model: settings.model
      })
      const excluded = [...new Set([...(this.data.aiExcludedSongIds || []).map(String), songId])]
      this.setData({
        aiExcludedSongIds: excluded,
        aiRecommendations: (this.data.aiRecommendations || []).filter((item) => String(item.song_id || '') !== songId),
        aiFeedbackSongId: '', aiFeedbackTags: [], aiFeedbackNote: '', aiFeedbackError: '',
        aiFeedbackOptions: AI_FEEDBACK_OPTIONS.map((item) => ({ ...item, selected: false }))
      })
    } catch (error) {
      this.setData({ aiFeedbackError: error.message || '反馈失败，请重试' })
    } finally {
      this.setData({ aiFeedbackSubmitting: false })
    }
  },
  onUseAiName(event) {
    const songId = String(event.currentTarget.dataset.songId || '')
    const recommendation = (this.data.aiRecommendations || []).find((item) => String(item.song_id || '') === songId)
    const songTitle = String(recommendation && recommendation.recommended_name || '').trim()
    const reason = String(recommendation && recommendation.reason || '').trim()
    if (!songTitle || !reason) return
    const { musicAssistant, musicAssistantSettings } = appServices()
    const settings = musicAssistantSettings && musicAssistantSettings.load ? musicAssistantSettings.load() : {}
    if (musicAssistant && typeof musicAssistant.submitNamingFeedback === 'function') {
      Promise.resolve(musicAssistant.submitNamingFeedback({
        songId, title: songTitle, artist: String(recommendation.artist || '').trim(), feedbackAction: 'used',
        reason, cocktailProfile: this.data.aiCocktailProfile, model: settings.model
      })).catch(() => {})
    }
    this.sync({
      ...this.data.form,
      name: songTitle,
      musicNaming: {
        songId,
        songTitle,
        artist: String(recommendation.artist || '').trim(),
        reason
      }
    }, this.data.errors)
    this.setData({ aiNamingOpen: false })
  },
  onTriedTap(event) { this.sync(updateTriedState(this.data.form, event.currentTarget.dataset.tried === 'true')) },
  onOpenMaterialSelect(event) {
    if (this.data.savingRecipe || this._openingMaterialSelect || typeof wx === 'undefined' || !wx.navigateTo) return
    const dataset = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset : {}
    const detail = event && event.detail ? event.detail : {}
    const categoryFilter = dataset.filter || detail.categoryFilter || 'all'
    const stage = dataset.stage || detail.stage || this.data.materialStage || 'serving'
    const preparationId = dataset.preparationId || detail.preparationId || ''
    const index = Number.isInteger(Number(dataset.index)) ? Number(dataset.index) : (Number.isInteger(Number(detail.index)) ? Number(detail.index) : -1)
    const materialSelectUrl = categoryFilter === 'all'
      ? '/pages/material-select/index'
      : `/pages/material-select/index?categoryFilter=${encodeURIComponent(categoryFilter)}`
    this._openingMaterialSelect = true
    wx.navigateTo({
      url: materialSelectUrl,
      fail: () => { this._openingMaterialSelect = false },
      success: ({ eventChannel }) => {
        if (!eventChannel) return
        if (eventChannel.on) eventChannel.on('material:selected', ({ material } = {}) => {
          if (material) this.sync(stage === 'advance' ? applyAdvanceMaterialSelection(this.data.form, preparationId, index, material) : applyMaterialSelection(this.data.form, index, material), this.data.errors)
        })
        if (eventChannel.emit) eventChannel.emit('material-select:init', { categoryFilter })
      }
    })
  },
  onIngredientChange(event) { const { index, field, value } = event.detail; const next = updateIngredientField(this.data.form, index, field, value); this.sync(next) },
  onRemoveIngredient(event) {
    const index = event.detail.index; const row = this.data.form.ingredients[index]
    if (row && row.kind === 'prepared-output') {
      if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') return
      return wx.showModal({
        title: '删除提前准备？',
        content: '删除这个材料后，对应的提前准备内容也会一起删除。',
        confirmText: '删除',
        confirmColor: '#985a54',
        success: ({ confirm }) => {
          if (confirm) this.sync(removeAdvancePreparation(this.data.form, row.preparationId), this.data.errors)
        }
      })
    }
    const ingredients = this.data.form.ingredients.filter((_, itemIndex) => itemIndex !== index); this.sync({ ...this.data.form, ingredients })
  },
  onIngredientDragStart(event) {
    this._ingredientDrag = { index: event.detail.index, lastY: Number(event.detail.y) || 0 }
    this.setData({ draggingIngredientIndex: event.detail.index })
  },
  onIngredientDragMove(event) {
    if (!this._ingredientDrag || this._ingredientDrag.index !== event.detail.index) return
    const y = Number(event.detail.y)
    if (!Number.isFinite(y)) return
    const delta = y - this._ingredientDrag.lastY
    if (Math.abs(delta) < 36) return
    const from = this._ingredientDrag.index
    const to = Math.max(0, Math.min(this.data.form.ingredients.length - 1, from + (delta > 0 ? 1 : -1)))
    if (to !== from) {
      this.sync(reorderIngredient(this.data.form, from, to), this.data.errors)
      this._ingredientDrag.index = to
      this._ingredientDrag.lastY = y
      this.setData({ draggingIngredientIndex: to })
    }
  },
  onIngredientDragEnd() { this._ingredientDrag = null; this.setData({ draggingIngredientIndex: -1 }) },
  onPickName(event) {
    const row = this.data.form.ingredients[event.detail.index]
    if (row && row.kind === 'prepared-output') return this.setData({ materialStage: 'advance' })
    this.onOpenMaterialSelect({ detail: { index: event.detail.index, categoryFilter: categoryFilterForIngredient(row) } })
  },
  onPickAdvanceName(event) {
    const preparation = this.data.form.advancePreparations.find((item) => item.id === event.detail.preparationId)
    const row = preparation && preparation.ingredients[event.detail.index]
    this.onOpenMaterialSelect({ detail: { index: event.detail.index, preparationId: event.detail.preparationId, categoryFilter: categoryFilterForIngredient(row), stage: 'advance' } })
  },
  onMaterialStage(event) { this.setData({ materialStage: event.currentTarget.dataset.stage === 'advance' ? 'advance' : 'serving' }) },
  onCreateAdvancePreparation() {
    const form = createAdvancePreparation(this.data.form)
    this.setData({ materialStage: 'advance' })
    this.sync(form, this.data.errors)
  },
  onAdvanceInput(event) { this.sync(updateAdvancePreparation(this.data.form, event.currentTarget.dataset.preparationId, event.currentTarget.dataset.field, event.detail.value), this.data.errors) },
  onAdvanceIngredientChange(event) {
    const { index, field, value, preparationId } = event.detail
    const preparationIndex = this.data.form.advancePreparations.findIndex(({ id }) => id === preparationId)
    if (preparationIndex === -1) return
    const preparation = this.data.form.advancePreparations[preparationIndex]
    const shadow = { ...this.data.form, advancePreparations: [], ingredients: preparation.ingredients }
    const changed = updateIngredientField(shadow, index, field, value)
    const advancePreparations = this.data.form.advancePreparations.map((item, itemIndex) => itemIndex === preparationIndex ? { ...item, ingredients: changed.ingredients } : item)
    this.sync({ ...this.data.form, advancePreparations }, this.data.errors)
  },
  onRemoveAdvanceIngredient(event) {
    const { preparationId, index } = event.detail
    const advancePreparations = this.data.form.advancePreparations.map((preparation) => preparation.id === preparationId ? { ...preparation, ingredients: preparation.ingredients.filter((_, itemIndex) => itemIndex !== index) } : preparation)
    this.sync({ ...this.data.form, advancePreparations }, this.data.errors)
  },
  onAdvanceDragStart(event) { this._advanceDrag = { preparationId: event.detail.preparationId, index: event.detail.index, lastY: Number(event.detail.y) || 0 }; this.setData({ draggingAdvanceIndex: event.detail.index, draggingAdvancePreparationId: event.detail.preparationId }) },
  onAdvanceDragMove(event) {
    if (!this._advanceDrag || this._advanceDrag.index !== event.detail.index || this._advanceDrag.preparationId !== event.detail.preparationId) return
    const y = Number(event.detail.y); const delta = y - this._advanceDrag.lastY
    if (!Number.isFinite(y) || Math.abs(delta) < 36) return
    const from = this._advanceDrag.index
    const preparationIndex = this.data.form.advancePreparations.findIndex(({ id }) => id === this._advanceDrag.preparationId)
    if (preparationIndex === -1) return
    const rows = this.data.form.advancePreparations[preparationIndex].ingredients
    const to = Math.max(0, Math.min(rows.length - 1, from + (delta > 0 ? 1 : -1)))
    if (to !== from) {
      const moved = reorderIngredient({ ingredients: rows }, from, to).ingredients
      const advancePreparations = this.data.form.advancePreparations.map((preparation, index) => index === preparationIndex ? { ...preparation, ingredients: moved } : preparation)
      this.sync({ ...this.data.form, advancePreparations }, this.data.errors)
      this._advanceDrag = { preparationId: this._advanceDrag.preparationId, index: to, lastY: y }; this.setData({ draggingAdvanceIndex: to })
    }
  },
  onAdvanceDragEnd() { this._advanceDrag = null; this.setData({ draggingAdvanceIndex: -1, draggingAdvancePreparationId: '' }) },
  onRemoveAdvancePreparation(event) {
    if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') return
    const preparationId = event.currentTarget.dataset.preparationId
    return wx.showModal({
      title: '删除提前准备？',
      content: '删除这项提前准备后，对应的饮用时材料也会一起删除。',
      confirmText: '删除',
      confirmColor: '#985a54',
      success: ({ confirm }) => {
        if (confirm) this.sync(removeAdvancePreparation(this.data.form, preparationId), this.data.errors)
      }
    })
  },
  suggestionsFor(index, query) {
    const ingredient = this.data.form.ingredients[index] || {}; const common = ingredient.category === 'citrus' ? ['柠檬汁', '青柠汁'] : ingredient.category === 'syrup/staple' ? ['糖浆', '蜂蜜糖浆', '肉桂糖浆'] : []
    const normalized = String(query || '').trim().toLowerCase()
    const existingByIdentity = new Map()
    this.materials.forEach((item) => {
      const identity = getMaterialIdentityKey(item.category, item.name)
      if (!existingByIdentity.has(identity)) existingByIdentity.set(identity, item)
    })
    const usedIdentities = new Set()
    const commonOptions = common.map((name) => {
      const identity = getMaterialIdentityKey(ingredient.category, name)
      const existing = existingByIdentity.get(identity)
      if (existing) {
        usedIdentities.add(identity)
        return { ...existing, name: getMaterialDisplayName(existing.category, existing.name), kind: 'existing', renderKey: `material:${existing.id}` }
      }
      usedIdentities.add(identity)
      return { name, category: ingredient.category, kind: 'replace', renderKey: `common:${ingredient.category}:${name}` }
    })
    const additionalMaterials = []
    this.materials.forEach((item, itemIndex) => {
      const identity = getMaterialIdentityKey(item.category, item.name)
      if (usedIdentities.has(identity)) return
      usedIdentities.add(identity)
      additionalMaterials.push({ ...item, name: getMaterialDisplayName(item.category, item.name), kind: 'existing', renderKey: `material:${item.id || `${item.category}:${item.name}:${itemIndex}`}` })
    })
    return [...commonOptions, ...additionalMaterials].filter((item) => !normalized || materialNameMatchesQuery(item.category, item.name, normalized))
  },
  onTogglePrep(event) {
    const type = event.detail.type; const existing = this.data.form.preparations || []; let preparations
    if (type === '即调') preparations = [{ type, note: '' }]
    else { preparations = existing.filter((item) => item.type !== '即调'); preparations = preparations.some((item) => item.type === type) ? preparations.filter((item) => item.type !== type) : [...preparations, { type, durationText: '', durationUnit: 'hour', note: '' }] }
    this.sync({ ...this.data.form, preparations })
  },
  onPrepChange(event) {
    const { index, field, value } = event.detail
    const displayed = this.data.formPreparations[index] || displayPrep(this.data.form.preparations[index] || {})
    const durationValue = field === 'durationValue' ? value : displayed.durationValue
    const durationUnit = field === 'durationUnit' ? value : displayed.durationUnit
    const durationText = formatPreparationDurationText(durationValue, durationUnit)
    const preparations = this.data.form.preparations.map((item, itemIndex) => itemIndex === index ? { ...item, durationText, durationUnit } : item)
    this.sync({ ...this.data.form, preparations })
  },
  onOpenGlasswareSelect() {
    if (this.data.savingRecipe || this._openingGlassSelect || typeof wx === 'undefined' || !wx.navigateTo) return
    this._openingGlassSelect = true
    wx.navigateTo({
      url: '/pages/glass-select/index',
      fail: () => { this._openingGlassSelect = false },
      success: ({ eventChannel }) => {
        if (!eventChannel) return
        if (eventChannel.on) eventChannel.on('glassware:selected', ({ glasswareId } = {}) => {
          if (typeof glasswareId === 'string') this.sync({ ...this.data.form, glasswareId }, this.data.errors)
        })
        if (eventChannel.emit) eventChannel.emit('glassware:init', { selectedId: this.data.form.glasswareId || '' })
      }
    })
  },
  onTools(event) { const indexes = event.detail.value || []; this.sync({ ...this.data.form, toolIds: indexes.map((index) => this.data.tools[Number(index)]).filter(Boolean).map((tool) => tool.id) }) },
  onRating(event) { this.sync({ ...this.data.form, rating: event.currentTarget.dataset.rating }) },
  noop() {},
  async onSave() {
    if (this._savingRecipe) return
    this._savingRecipe = true
    this.setData({ savingRecipe: true, formError: '' })
    const result = await orchestrateRecipeSave({ repository: repository(), form: this.data.form, notify: (title) => { if (typeof wx !== 'undefined') wx.showToast({ title, icon: 'none' }) }, navigateBack: () => { if (typeof wx !== 'undefined' && wx.navigateBack) wx.navigateBack() } })
    if (!result.saved) {
      this._savingRecipe = false
      this.setData({ savingRecipe: false })
      if (Object.keys(result.errors).length) this.sync(result.form, result.errors)
    }
  }
})
