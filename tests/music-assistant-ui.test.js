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

test('recipe editor offers AI naming beside the name and renders recommendation reasons', () => {
  const wxml = read('miniprogram/pages/recipe-edit/index.wxml')
  assert.match(wxml, /class="name-row"[\s\S]*bindtap="onOpenAiNaming"/)
  assert.match(wxml, /酒的颜色/)
  assert.match(wxml, /起名偏好/)
  assert.match(wxml, /\{\{item\.reason\}\}/)
})
