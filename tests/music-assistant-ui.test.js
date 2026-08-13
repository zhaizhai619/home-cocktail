const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

test('recipe list exposes the beta AI naming entry above search', () => {
  const wxml = read('miniprogram/pages/recipes/index.wxml')
  assert.ok(wxml.indexOf('ai-naming-banner') < wxml.indexOf('search-box'))
  assert.match(wxml, /体验版/)
  assert.match(read('miniprogram/pages/recipes/index.js'), /onOpenMusicNaming/)
})

test('music naming page collects local settings and shows import progress', () => {
  const app = JSON.parse(read('miniprogram/app.json'))
  assert.ok(app.pages.includes('pages/music-naming/index'))
  const wxml = read('miniprogram/pages/music-naming/index.wxml')
  for (const label of ['DeepSeek API Key', '模型名称', '导入歌曲数量', '已完成', '解析失败']) assert.match(wxml, new RegExp(label))
})

test('checking NetEase login always gives visible progress and a result', () => {
  const js = read('miniprogram/pages/music-naming/index.js')
  const wxml = read('miniprogram/pages/music-naming/index.wxml')
  assert.match(js, /checkingLogin:\s*false/)
  assert.match(js, /正在检查网易云登录状态/)
  assert.match(js, /暂未检测到登录/)
  assert.match(js, /检查网易云登录状态失败/)
  assert.doesNotMatch(js, /catch\s*\(_\)\s*\{\s*\}/)
  assert.match(wxml, /loading="\{\{checkingLogin\}\}"/)
  assert.match(wxml, /disabled="\{\{checkingLogin \|\| loadingLogin\}\}"/)
  assert.match(wxml, /\{\{checkingLogin \? '检查中…' : '检查登录'\}\}/)
})

test('music assistant deployment allows one lyric and model call to finish', () => {
  const functionConfig = JSON.parse(read('cloudfunctions/musicAssistant/config.json'))
  const cloudbaseConfig = JSON.parse(read('cloudbaserc.json'))
  const deployment = cloudbaseConfig.functions.find((item) => item.name === 'musicAssistant')
  assert.ok(functionConfig.timeout >= 120)
  assert.ok(deployment)
  assert.ok(deployment.timeout >= 120)
})

test('recipe editor offers AI naming beside the name and renders recommendation reasons', () => {
  const wxml = read('miniprogram/pages/recipe-edit/index.wxml')
  assert.match(wxml, /class="name-row"[\s\S]*bindtap="onOpenAiNaming"/)
  assert.match(wxml, /酒的颜色/)
  assert.match(wxml, /起名偏好/)
  assert.match(wxml, /\{\{item\.reason\}\}/)
})
