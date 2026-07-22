const { MATERIAL_CATEGORY_GROUPS, getMaterialIdentityKey } = require('../../domain/material')
const { MATERIAL_LIBRARY_TABS, buildMaterialLibrary } = require('../materials/model')

const CREATION_CATEGORIES = MATERIAL_CATEGORY_GROUPS.map(({ key, label, category }) => ({ key, label, category }))

function repository() {
  const app = typeof getApp === 'function' && getApp()
  return app && app.globalData && app.globalData.repository
}

Page({
  data: { categoryTabs: MATERIAL_LIBRARY_TABS, creationCategories: CREATION_CATEGORIES, categoryFilter: 'all', query: '', materials: [], canCreateMaterial: false, creatingMaterial: false, newMaterialName: '' },
  onLoad(query) {
    const routeFilter = query && query.categoryFilter
    const validRouteFilter = MATERIAL_LIBRARY_TABS.some((item) => item.key === routeFilter)
    if (validRouteFilter) this.setData({ categoryFilter: routeFilter })
    this.channel = typeof this.getOpenerEventChannel === 'function' ? this.getOpenerEventChannel() : null
    if (this.channel && this.channel.on) this.channel.on('material-select:init', ({ categoryFilter } = {}) => {
      const valid = MATERIAL_LIBRARY_TABS.some((item) => item.key === categoryFilter)
      this.setData({ categoryFilter: valid ? categoryFilter : 'all' })
      this.reload()
    })
    this.reload()
  },
  onShow() { this.reload() },
  reload() {
    const repo = repository()
    const result = buildMaterialLibrary(repo ? repo.listMaterials() : [], repo ? repo.listRecipes() : [], {
      includeCatalog: true,
      categoryFilter: this.data.categoryFilter,
      search: this.data.query
    })
    const newMaterialName = String(this.data.query || '').trim()
    const exact = newMaterialName && result.materials.some((item) => getMaterialIdentityKey(item.category, item.name) === getMaterialIdentityKey(item.category, newMaterialName))
    this.setData({ materials: result.materials, newMaterialName, canCreateMaterial: Boolean(newMaterialName && !exact) })
  },
  onSearchInput(event) { this.setData({ query: event.detail.value || '', creatingMaterial: false }); this.reload() },
  onSelectCategory(event) { this.setData({ categoryFilter: event.currentTarget.dataset.key || 'all', creatingMaterial: false }); this.reload() },
  finish(material) {
    if (this._finishing || !material) return
    this._finishing = true
    if (this.channel && this.channel.emit) this.channel.emit('material:selected', { material })
    if (typeof wx !== 'undefined' && wx.navigateBack) wx.navigateBack()
  },
  onSelectMaterial(event) {
    const renderKey = event.currentTarget.dataset.key
    this.finish(this.data.materials.find((item) => item.renderKey === renderKey))
  },
  onCreateMaterial() {
    const name = String(this.data.newMaterialName || '').trim()
    if (!this.data.canCreateMaterial || !name) return
    this.setData({ creatingMaterial: true })
  },
  onSelectCreateCategory(event) {
    const selected = CREATION_CATEGORIES.find((item) => item.category === event.currentTarget.dataset.category)
    const name = String(this.data.newMaterialName || '').trim()
    if (!selected || !this.data.canCreateMaterial || !name) return
    this.finish({ name, category: selected.category, isNew: true })
  }
})
