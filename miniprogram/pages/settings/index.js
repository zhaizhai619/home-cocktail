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
    savingAvatar: false
  },

  onShow() {
    const repository = appService('profileRepository')
    this.setData({
      profile: repository ? repository.getProfile() : FALLBACK_PROFILE,
      syncTimeLabel: '待接入云端'
    })
  },

  onNicknameCommit(event) {
    const repository = appService('profileRepository')
    const nickname = String(event.detail && event.detail.value || '').trim()
    if (!repository || !nickname) {
      this.setData({ profile: { ...this.data.profile } })
      if (!nickname) toast('名字不能为空')
      return
    }
    try {
      this.setData({ profile: repository.saveProfile({ nickname }) })
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
      const profile = repository.saveProfile({ avatarPath: persisted.path })
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
  }
})
