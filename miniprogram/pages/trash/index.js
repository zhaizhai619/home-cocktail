const { waitForCloudReady } = require('../../services/page-ready')

const TYPE_LABELS = { recipe: '酒单', material: '材料', glassware: '酒杯', tool: '用具' }

function appService(name) {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData[name]
}

function toast(title) {
  if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon: 'none' })
}

function dateLabel(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

Page({
  data: { items: [], loading: true, restoringId: '', error: '' },

  async onShow() {
    await waitForCloudReady()
    await this.reload()
  },

  async reload() {
    const session = appService('cloudSession')
    if (!session) return this.setData({ loading: false, error: '云端服务暂不可用' })
    this.setData({ loading: true, error: '' })
    try {
      const items = await session.listTrash()
      this.setData({
        loading: false,
        items: items.map((entry) => ({
          ...entry,
          typeLabel: TYPE_LABELS[entry.entityType] || '记录',
          name: String(entry.item && entry.item.name || '未命名'),
          deletedAtLabel: dateLabel(entry.deletedAt),
          expiresAtLabel: dateLabel(entry.expiresAt)
        }))
      })
    } catch (error) {
      this.setData({ loading: false, error: error && error.message || '加载失败，请重试' })
    }
  },

  async onRestore(event) {
    const id = String(event.currentTarget.dataset.id || '')
    const session = appService('cloudSession')
    if (!id || !session || this.data.restoringId) return
    this.setData({ restoringId: id })
    try {
      await session.restoreTrash(id)
      toast('已恢复')
      await this.reload()
    } catch (error) {
      toast(error && error.message || '恢复失败，请重试')
    } finally {
      this.setData({ restoringId: '' })
    }
  }
})
