const friendMenuPreview = require('../../services/friend-menu-preview')
const { filterAndSortRecipeCards } = require('../recipes/model')

function materialLookup(materials) {
  return (Array.isArray(materials) ? materials : []).reduce((lookup, material) => {
    if (material && material.id) lookup[material.id] = material
    return lookup
  }, Object.create(null))
}

Page({
  data: {
    state: 'loading',
    menu: null,
    recipes: [],
    errorMessage: ''
  },
  onLoad(query) {
    this.menuId = query && query.menuId
    this.loadMenu()
  },
  loadMenu() {
    const service = this.friendMenuService || friendMenuPreview
    this.setData({ state: 'loading', errorMessage: '' })
    try {
      const result = service.getMenu(this.menuId)
      if (!result || result.status !== 'ok') {
        this.setData({ state: 'missing', menu: null, recipes: [] })
        return
      }
      const cards = filterAndSortRecipeCards(result.recipes, materialLookup(result.materials), {})
      this.setData({
        state: cards.length ? 'ok' : 'empty',
        menu: result.menu,
        recipes: cards
      })
      if (typeof wx !== 'undefined' && wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: result.menu.name || '好友酒单' })
    } catch (_) {
      this.setData({ state: 'error', menu: null, recipes: [], errorMessage: '好友酒单暂时加载失败，请稍后重试' })
    }
  },
  onRetry() { this.loadMenu() },
  onEditMenuName() {
    if (!this.data.menu || typeof wx === 'undefined' || !wx.showModal) return
    wx.showModal({
      title: '编辑酒单名称',
      content: this.data.menu.name || '',
      editable: true,
      placeholderText: '请输入酒单名称',
      confirmText: '保存',
      success: ({ confirm, content }) => {
        if (!confirm) return
        const service = this.friendMenuService || friendMenuPreview
        const result = service.renameMenu(this.menuId, content)
        if (!result || result.status !== 'ok') {
          if (wx.showToast) wx.showToast({ title: '请输入1到30个字', icon: 'none' })
          return
        }
        this.setData({ menu: { ...this.data.menu, ...result.menu } })
        if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: result.menu.name })
      }
    })
  },
  onSelectRecipe(event) {
    const id = event && event.detail && event.detail.id
    if (!id || !this.menuId) return
    wx.navigateTo({
      url: `/pages/recipe-detail/index?mode=friend-preview&menuId=${encodeURIComponent(this.menuId)}&id=${encodeURIComponent(id)}`
    })
  },
  onBackToFriends() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (this.data.menu && pages.length > 1 && wx.navigateBack) return wx.navigateBack()
    const app = typeof getApp === 'function' ? getApp() : null
    if (app && app.globalData) app.globalData.sharedMenuReturnIntent = true
    if (typeof wx !== 'undefined' && wx.switchTab) wx.switchTab({ url: '/pages/recipes/index' })
  }
})
