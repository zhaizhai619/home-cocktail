const { waitForCloudReady } = require('../../services/page-ready')

function services() {
  const app = typeof getApp === 'function' ? getApp() : null
  return app && app.globalData ? app.globalData : {}
}

function progress(job) {
  const value = job && job.progress || {}
  const processed = Number(value.completed || 0) + Number(value.failed || 0) + Number(value.skipped || 0)
  const total = Number(value.total || 0)
  return { processed, total, percent: total ? Math.round(processed / total * 100) : 0 }
}

Page({
  data: {
    apiKey: '', model: 'deepseek-v4-flash', importCount: 20,
    job: null, processed: 0, total: 0, percent: 0, analyzedCount: 0,
    ncmLoggedIn: false, ncmNickname: '', ncmQrUrl: '',
    loadingLogin: false, analyzing: false, statusText: '', error: ''
  },
  async onLoad() {
    await waitForCloudReady()
    const { musicAssistantSettings } = services()
    if (musicAssistantSettings) this.setData(musicAssistantSettings.load())
    await this.refreshStatus()
    await this.onCheckNcmLogin()
  },
  onUnload() { this._active = false },
  onFieldInput(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }) },
  saveLocalSettings() {
    const { musicAssistantSettings } = services()
    if (!musicAssistantSettings) throw new Error('本地设置服务不可用')
    const settings = musicAssistantSettings.save(this.data)
    this.setData(settings)
    return settings
  },
  async refreshStatus() {
    const { musicAssistant } = services()
    if (!musicAssistant) return
    try {
      const result = await musicAssistant.getStatus()
      const job = result.job || null
      this.setData({ job, analyzedCount: result.analyzedCount || 0, ...progress(job) })
    } catch (error) { this.setData({ error: error.message || '读取进度失败' }) }
  },
  async onConnectNcm() {
    const { musicAssistant } = services()
    if (!musicAssistant || this.data.loadingLogin) return
    this.setData({ loadingLogin: true, error: '' })
    try {
      const state = await musicAssistant.startNcmLogin()
      this.setData({ ncmLoggedIn: Boolean(state.loggedIn), ncmNickname: state.nickname || '', ncmQrUrl: state.qrUrl || '', statusText: state.loggedIn ? '网易云已连接' : '请完成网易云登录后点击“检查登录”' })
    } catch (error) { this.setData({ error: error.message || '网易云连接失败' }) }
    this.setData({ loadingLogin: false })
  },
  async onCheckNcmLogin() {
    const { musicAssistant } = services()
    if (!musicAssistant) return
    try {
      const state = await musicAssistant.checkNcmLogin()
      this.setData({ ncmLoggedIn: Boolean(state.loggedIn), ncmNickname: state.nickname || '', ncmQrUrl: state.qrUrl || this.data.ncmQrUrl, statusText: state.loggedIn ? '网易云已连接' : this.data.statusText })
    } catch (_) {}
  },
  async onStartAnalysis() {
    if (this.data.analyzing) return
    let settings
    try { settings = this.saveLocalSettings() } catch (error) { return this.setData({ error: error.message }) }
    if (!settings.apiKey) return this.setData({ error: '请填写 DeepSeek API Key' })
    const { musicAssistant } = services()
    if (!musicAssistant) return this.setData({ error: '智能起名服务不可用' })
    this.setData({ analyzing: true, error: '', statusText: '正在读取红心歌曲…' })
    try {
      const job = await musicAssistant.startJob({ model: settings.model, limit: settings.importCount })
      this.setData({ job, ...progress(job) })
      await this.runJob(settings)
    } catch (error) {
      this.setData({ error: error.message || '无法开始解析', analyzing: false })
    }
  },
  async onResumeAnalysis() {
    if (this.data.analyzing || !this.data.job) return
    const settings = this.saveLocalSettings()
    if (!settings.apiKey) return this.setData({ error: '请填写 DeepSeek API Key' })
    this.setData({ analyzing: true, error: '' })
    await this.runJob(settings)
  },
  async runJob(settings) {
    const { musicAssistant } = services()
    this._active = true
    let job = this.data.job
    try {
      while (this._active && job && job.status !== 'completed') {
        this.setData({ statusText: `正在解析第 ${progress(job).processed + 1} 首…` })
        job = await musicAssistant.processNext({ jobId: job.id, apiKey: settings.apiKey, model: settings.model })
        this.setData({ job, ...progress(job) })
        if (job.busy) await new Promise((resolve) => setTimeout(resolve, 800))
      }
      if (job && job.status === 'completed') this.setData({ statusText: '歌曲解析完成，可以去添加酒品并使用智能起名了' })
      await this.refreshStatus()
    } catch (error) { this.setData({ error: error.message || '解析中断，可稍后继续' }) }
    this.setData({ analyzing: false })
  }
})
