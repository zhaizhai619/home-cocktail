const { waitForCloudReady } = require('../../services/page-ready')
const { createWxBackupService } = require('../../services/cloud-backup')

function appService(name) {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData && app.globalData[name]
}

function toast(title) {
  if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon: 'none' })
}

const FALLBACK_PROFILE = {
  id: '',
  nickname: '酒友',
  avatarPath: '',
  updatedAt: ''
}

Page({
  data: {
    profile: FALLBACK_PROFILE,
    syncTimeLabel: '待接入云端',
    savingAvatar: false,
    exportingBackup: false
  },

  async onShow() {
    await waitForCloudReady()
    const repository = appService('profileRepository')
    const status = appService('cloudStatus') || {}
    this.setData({
      profile: repository ? repository.getProfile() : FALLBACK_PROFILE,
      syncTimeLabel: status.online ? '数据已安全同步到云端' : '当前离线，只能查看'
    })
  },

  async onNicknameCommit(event) {
    const repository = appService('profileRepository')
    const nickname = String(event.detail && event.detail.value || '').trim()
    if (!repository || !nickname) {
      this.setData({ profile: { ...this.data.profile } })
      if (!nickname) toast('名字不能为空')
      return
    }
    try {
      this.setData({ profile: await repository.saveProfile({ nickname }) })
    } catch (error) {
      toast(error && error.message || '保存失败，请重试')
      this.setData({ profile: { ...this.data.profile } })
    }
  },

  async onChooseAvatar(event) {
    if (this.data.savingAvatar) return
    const sourcePath = event.detail && event.detail.avatarUrl
    const repository = appService('profileRepository')
    const mediaFiles = appService('mediaFiles')
    if (!sourcePath || !repository || !mediaFiles) return

    const previousPath = this.data.profile.avatarPath
    this.setData({ savingAvatar: true })
    let persisted = null
    try {
      persisted = await mediaFiles.persistProfileImage(sourcePath)
      const profile = await repository.saveProfile({ avatarPath: persisted.path })
      this.setData({ profile })
      if (previousPath && previousPath !== persisted.path && mediaFiles.isManagedProfilePath(previousPath)) {
        try { await mediaFiles.removeManagedFile(previousPath) } catch (_) { toast('旧头像清理失败，不影响使用') }
      }
    } catch (error) {
      if (typeof console !== 'undefined' && console.error) console.error('头像保存失败', error)
      if (persisted && persisted.created) {
        try { await mediaFiles.removeManagedFile(persisted.path) } catch (_) {}
      }
      toast('头像保存失败，请重试')
    } finally {
      this.setData({ savingAvatar: false })
    }
  },

  onOpenTrash() {
    if (typeof wx !== 'undefined' && wx.navigateTo) wx.navigateTo({ url: '/pages/trash/index' })
  },

  async onExportBackup() {
    if (this.data.exportingBackup) return
    const session = appService('cloudSession')
    if (!session) return toast('云端数据暂不可用')
    this.setData({ exportingBackup: true })
    try {
      const backup = createWxBackupService(wx)
      const file = await backup.exportSnapshot(session.getSnapshot())
      if (typeof wx.shareFileMessage !== 'function') throw new Error('当前微信版本不支持分享文件')
      await new Promise((resolve, reject) => wx.shareFileMessage({
        filePath: file.filePath,
        fileName: file.fileName,
        success: resolve,
        fail: reject
      }))
    } catch (error) {
      toast(error && error.message || '导出失败，请重试')
    } finally {
      this.setData({ exportingBackup: false })
    }
  }
})
