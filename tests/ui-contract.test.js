const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const MINI = path.join(ROOT, 'miniprogram')

function walk(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute, extension)
    return entry.isFile() && entry.name.endsWith(extension) ? [absolute] : []
  })
}

function registeredDefinition(jsFile, wxOverrides = {}) {
  let definition = null
  const source = fs.readFileSync(jsFile, 'utf8')
  const sandbox = {
    require: createRequire(jsFile),
    Page(value) { definition = value },
    Component(value) { definition = value },
    App(value) { definition = value },
    getApp() { return null },
    wx: wxOverrides,
    console,
    setTimeout,
    clearTimeout
  }
  vm.runInNewContext(source, sandbox, { filename: jsFile })
  return definition
}

function eventHandlers(wxml) {
  return [...wxml.matchAll(/\b(?:bind|catch)(?:[a-z][\w-]*|:[a-z][\w-]*)="([A-Za-z_$][\w$]*)"/g)].map((match) => match[1])
}

test('every mini-program JSON file parses and every declared page route has a complete file set', () => {
  const app = JSON.parse(fs.readFileSync(path.join(MINI, 'app.json'), 'utf8'))
  for (const file of walk(MINI, '.json')) assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')), file)
  for (const route of app.pages) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) assert.equal(fs.existsSync(path.join(MINI, `${route}${extension}`)), true, `${route}${extension}`)
  }
})

test('native tab bar provides local normal and selected icons for all three entries', () => {
  const app = JSON.parse(fs.readFileSync(path.join(MINI, 'app.json'), 'utf8'))
  assert.equal(app.tabBar.list.length, 3)
  for (const item of app.tabBar.list) {
    assert.match(item.iconPath, /^assets\/tabbar\/[^/]+\.png$/)
    assert.match(item.selectedIconPath, /^assets\/tabbar\/[^/]+-active\.png$/)
    assert.equal(fs.existsSync(path.join(MINI, item.iconPath)), true, item.iconPath)
    assert.equal(fs.existsSync(path.join(MINI, item.selectedIconPath)), true, item.selectedIconPath)
  }
})

test('native tab bar uses receipt text for recipes and martini for the bar', () => {
  const tabbar = path.join(MINI, 'assets/tabbar')
  const expectedGeometry = {
    menu: '<path d="M13 16H8"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/>',
    materials: '<path d="M12 12 4.207 4.207A.707.707 0 0 1 4.707 3h14.586a.707.707 0 0 1 .5 1.207z"/><path d="M12 12v10"/><path d="M7 22h10"/>'
  }
  const expectedPngHashes = {
    menu: '1e4595eda0753cc5b2556647781cfca666f064ed2445b3fc0d84895d7126d05c',
    'menu-active': 'dc3d28a695aff62718c856037a5324d4670e591e9a43f20149a7bcb7e31c1137',
    materials: 'de168e4d2d4fa080ab2fb6e0e70b871024d2076ef17cfa94610511d4529687aa',
    'materials-active': '548c23edccd87f03533bd39bb732c06787de929b750a42ae97f6661b1cfc843c'
  }

  for (const [name, geometry] of Object.entries(expectedGeometry)) {
    const normalSvg = fs.readFileSync(path.join(tabbar, `${name}.svg`), 'utf8')
    const activeSvg = fs.readFileSync(path.join(tabbar, `${name}-active.svg`), 'utf8')
    assert.equal(normalSvg.match(/^<svg[^>]*>(.*)<\/svg>\s*$/)[1], geometry)
    assert.equal(activeSvg.match(/^<svg[^>]*>(.*)<\/svg>\s*$/)[1], geometry)
    assert.match(normalSvg, /stroke="#9d9991"[^>]*stroke-width="1\.8"/)
    assert.match(activeSvg, /stroke="#242321"[^>]*stroke-width="2\.1"/)

    for (const suffix of ['', '-active']) {
      const pngName = `${name}${suffix}`
      const png = fs.readFileSync(path.join(tabbar, `${pngName}.png`))
      assert.equal(png.readUInt32BE(16), 81)
      assert.equal(png.readUInt32BE(20), 81)
      assert.equal(png[25], 6)
      assert.equal(createHash('sha256').update(png).digest('hex'), expectedPngHashes[pngName])
    }
  }
})

test('every WXML event binding resolves to a page or component method', () => {
  for (const wxmlFile of walk(MINI, '.wxml')) {
    const jsFile = wxmlFile.replace(/\.wxml$/, '.js')
    const definition = registeredDefinition(jsFile)
    assert.ok(definition, `no Page/Component definition in ${jsFile}`)
    const methods = { ...definition, ...(definition.methods || {}) }
    for (const handler of eventHandlers(fs.readFileSync(wxmlFile, 'utf8'))) {
      assert.equal(typeof methods[handler], 'function', `${path.relative(ROOT, wxmlFile)} -> ${handler}`)
    }
  }
})

test('pages access persistence only through the repository service', () => {
  const forbidden = /wx\.(?:getStorage|getStorageSync|setStorage|setStorageSync|removeStorage|removeStorageSync|clearStorage|clearStorageSync)\b/
  for (const file of walk(path.join(MINI, 'pages'), '.js')) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), forbidden, file)
  for (const file of walk(path.join(MINI, 'components'), '.js')) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), forbidden, file)
})

test('profile page stays minimal and makes only avatar and nickname editable', () => {
  const template = fs.readFileSync(path.join(MINI, 'pages/settings/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/settings/index.wxss'), 'utf8')
  const script = fs.readFileSync(path.join(MINI, 'pages/settings/index.js'), 'utf8')

  assert.match(template, /class="avatar-shell"[\s\S]*class="avatar-picker"[^>]*open-type="chooseAvatar"[^>]*bindchooseavatar="onChooseAvatar"/)
  assert.match(template, /class="nickname-input"[^>]*type="nickname"[^>]*bindblur="onNicknameCommit"/)
  assert.match(template, /\{\{profile\.nickname\}\}/)
  assert.match(template, />数据同步时间</)
  assert.match(template, /\{\{syncTimeLabel\}\}/)
  assert.match(template, />点击头像和名字即可编辑</)
  assert.doesNotMatch(template, /数据概览|数据安全|帮助与关于|使用帮助|意见反馈|隐私政策|关于小程序/)
  assert.match(css, /\.avatar-shell\s*{[^}]*position:\s*relative[^}]*width:\s*144rpx[^}]*height:\s*144rpx[^}]*overflow:\s*hidden[^}]*border-radius:\s*50%/)
  assert.match(css, /\.avatar-picker\s*{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%[^}]*opacity:\s*0/)
  assert.match(css, /\.avatar-image,\s*\.avatar-fallback\s*{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*border-radius:\s*50%/)
  assert.match(css, /\.sync-row,\s*\.data-action\s*{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/)
  assert.match(script, /mediaFiles\.isManagedProfilePath\(previousPath\)/)
  assert.doesNotMatch(script, /mediaFiles\.isManagedPath\(previousPath\)/)
})

test('static navigation targets point only to routes declared in app.json', () => {
  const app = JSON.parse(fs.readFileSync(path.join(MINI, 'app.json'), 'utf8'))
  const routes = new Set(app.pages.map((route) => `/${route}`))
  for (const file of walk(path.join(MINI, 'pages'), '.js')) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(?:url:\s*[`'"])(\/pages\/[^?`'"]+)/g)) assert.equal(routes.has(match[1]), true, `${path.relative(ROOT, file)} -> ${match[1]}`)
  }
})

test('bar locks every glass editor control while an asynchronous save is active', () => {
  const wxml = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxml'), 'utf8')
  const sheet = wxml.match(/<view wx:if="{{glassEditorOpen}}"[\s\S]*?<\/view>\s*<\/view>/)[0]
  for (const tag of sheet.match(/<(?:input|button)\b[^>]*>/g)) {
    assert.match(tag, /disabled="{{savingGlass}}"/, tag)
  }
})

test('materials catalog uses compact scrollable tabs and an aligned two-column card grid', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/materials/index.js'))
  const wxml = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxss'), 'utf8')
  assert.deepEqual(Array.from(page.data.categoryTabs, ({ label }) => label), ['全部', '基酒', '利口酒', '糖浆', '果汁/果蔬', '混合饮品', '香料', '其他'])
  assert.match(wxml, /<scroll-view[^>]*scroll-x[^>]*class="catalog-tabs"/)
  assert.match(wxml, /class="catalog-tab/)
  assert.doesNotMatch(wxml, /class="acquisition-row"|全部类型|>长期材料<|>随买随用</)
  assert.match(wxml, /class="library-grid"/)
  assert.match(wxml, /<button[^>]*size="mini"[^>]*class="library-card/)
  assert.match(css, /\.materials-page \.catalog-tab\s*{[^}]*height:\s*60rpx[^}]*min-height:\s*60rpx[^}]*padding:\s*0 20rpx/)
  assert.match(css, /\.library-grid\s*{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*align-items:\s*stretch/)
  assert.match(css, /\.materials-page \.library-card\s*{[^}]*box-sizing:\s*border-box[^}]*width:\s*100%[^}]*min-height:\s*176rpx/)
  assert.match(css, /\.library-card\.state-owned\s*{[^}]*background:/)
  assert.match(css, /\.library-card\.state-missing-long-term[^}]*{[^}]*border:/)
  assert.match(wxml, /wx:else class="empty-materials"><text>没有符合要求的材料<\/text><\/view>/)
  assert.doesNotMatch(wxml, /没有符合条件的材料|新增一种材料/)
  assert.match(css, /\.empty-materials\s*{[^}]*margin-top:\s*32rpx[^}]*color:\s*#9d9991[^}]*font-size:\s*23rpx[^}]*text-align:\s*center/)
  assert.doesNotMatch(css, /\.empty-materials\s*{[^}]*(?:background|border|box-shadow):/)
})

test('choosing a category without search matches clears the query before reloading', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/materials/index.js'))
  const context = {
    data: {
      ...page.data,
      search: '黄瓜',
      categoryFilter: 'all',
      searchMatchCategoryKeys: ['produce', 'mixer']
    },
    reloadCount: 0,
    setData(value) { Object.assign(this.data, value) },
    reload() { this.reloadCount += 1 }
  }

  page.onSelectCategory.call(context, { currentTarget: { dataset: { key: 'base' } } })
  assert.equal(context.data.categoryFilter, 'base')
  assert.equal(context.data.search, '')
  assert.equal(context.reloadCount, 1)

  context.data.search = '黄瓜'
  page.onSelectCategory.call(context, { currentTarget: { dataset: { key: 'produce' } } })
  assert.equal(context.data.categoryFilter, 'produce')
  assert.equal(context.data.search, '黄瓜')
  assert.equal(context.reloadCount, 2)

  context.data.search = '完全不存在的材料'
  context.data.searchMatchCategoryKeys = []
  page.onSelectCategory.call(context, { currentTarget: { dataset: { key: 'all' } } })
  assert.equal(context.data.categoryFilter, 'all')
  assert.equal(context.data.search, '')
  assert.equal(context.reloadCount, 3)
})

test('fresh shelf defaults to purchase rows and expands one inline recipe list', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/materials/index.js'))
  const wxml = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxss'), 'utf8')
  const context = {
    data: { ...page.data },
    setData(value) { Object.assign(this.data, value) }
  }

  assert.equal(page.data.freshShelfExpanded, true)
  assert.equal(page.data.expandedFreshMaterialId, '')
  page.onToggleFreshItem.call(context, { currentTarget: { dataset: { id: 'mint' } } })
  assert.equal(context.data.expandedFreshMaterialId, 'mint')
  page.onToggleFreshItem.call(context, { currentTarget: { dataset: { id: 'lime' } } })
  assert.equal(context.data.expandedFreshMaterialId, 'lime')
  page.onToggleFreshItem.call(context, { currentTarget: { dataset: { id: 'lime' } } })
  assert.equal(context.data.expandedFreshMaterialId, '')
  page.onToggleFreshItem.call(context, { currentTarget: { dataset: { id: 'mint' } } })
  page.onToggleFreshShelf.call(context)
  assert.equal(context.data.freshShelfExpanded, false)
  assert.equal(context.data.expandedFreshMaterialId, '')
  page.onToggleFreshShelf.call(context)
  assert.equal(context.data.freshShelfExpanded, true)

  assert.match(wxml, /class="section-head fresh-section-head"[^>]*bindtap="onToggleFreshShelf"/)
  assert.match(wxml, /class="fresh-disclosure-chevron \{\{freshShelfExpanded \? 'is-expanded' : ''\}\}"/)
  assert.doesNotMatch(wxml, /class="disclosure"[^>]*>\{\{freshShelfExpanded \? '收起' : '展开'\}\}/)
  assert.match(wxml, /wx:if="{{freshShelfExpanded}}"[^>]*class="fresh-list"/)
  assert.match(wxml, /class="fresh-summary"[^>]*bindtap="onToggleFreshItem"/)
  assert.match(wxml, /class="fresh-remaining \{\{item\.needsReminder \? 'is-alert' : ''\}\} \{\{item\.remainingMissing \? 'is-empty' : ''\}\}"[^>]*catchtap="onOpenRemainingEditor"[^>]*data-id="\{\{item\.id\}\}"/)
  assert.match(wxml, /wx:if="{{item\.needsReminder}}"[^>]*class="fresh-alert-mark"[^>]*>!<\/text>\s*<text class="fresh-remaining-label \{\{item\.remainingMissing \? 'is-empty' : ''\}\}">/)
  assert.match(wxml, /\{\{item\.needsReminder \? item\.reminderLabel : item\.remainingLabel\}\}/)
  assert.match(wxml, /class="fresh-detail-meta"[\s\S]*购买日期 \{\{item\.purchaseDateLabel \|\| '未填写'\}\}[\s\S]*预计到期 \{\{item\.expiryDateLabel \|\| '未填写'\}\}/)
  assert.match(wxml, /catchtap="onUseUp"/)
  assert.doesNotMatch(wxml, /优先用掉，少一点浪费/)
  assert.doesNotMatch(wxml, /fresh-summary-actions|expandedFreshMaterialId === item\.id \? '⌃' : '⌄'/)
  assert.match(wxml, /wx:if="{{expandedFreshMaterialId === item\.id}}"[^>]*class="fresh-recipes"/)
  assert.match(wxml, /wx:for="{{item\.relatedRecipes}}"[^>]*class="fresh-recipe-row"[^>]*bindtap="onOpenRecipe"/)
  assert.match(wxml, /{{recipe\.rating \|\| '未调过'}}/)
  assert.match(wxml, /{{recipe\.materialAmountLabel}}/)
  assert.doesNotMatch(wxml, /fresh-recipe-recommended|>推荐</)
  assert.match(wxml, /酒单中暂时没有使用这个材料/)
  assert.doesNotMatch(wxml, /{{item\.recommendedRecipe\.name}}|onOpenFreshRecipes|recipeSheetOpen|看能做什么/)
  assert.doesNotMatch(wxml, /scroll-x[^>]*class="fresh-scroll"/)
  assert.doesNotMatch(wxml, /fresh-name-row"[^>]*bindtap="onOpenMaterial"/)
  assert.match(css, /\.fresh-list\s*{[^}]*display:\s*grid/)
  assert.match(css, /\.fresh-disclosure-chevron\s*{[^}]*border-right:[^;}]+solid[^}]*border-bottom:[^;}]+solid[^}]*transform:\s*rotate\(45deg\)/)
  assert.match(css, /\.fresh-disclosure-chevron\.is-expanded\s*{[^}]*transform:\s*rotate\(-135deg\)/)
  assert.match(css, /\.fresh-card\s*{[^}]*width:\s*100%/)
  assert.match(css, /\.fresh-summary\s*{[^}]*display:\s*grid[^}]*grid-template-columns:/)
  assert.match(css, /\.fresh-remaining\s*{[^}]*color:\s*#6f6c66[^}]*font-size:\s*23rpx/)
  assert.match(css, /\.fresh-remaining\.is-alert\s*{[^}]*color:\s*#985a54[^}]*background:\s*#f6e3df[^}]*border:\s*1rpx solid #d98c82/)
  assert.match(css, /\.fresh-remaining-label\.is-empty\s*{[^}]*text-decoration:\s*underline[^}]*text-underline-offset:/)
  assert.doesNotMatch(css, /\.fresh-remaining\.is-empty\s*{[^}]*text-decoration:/)
  assert.match(css, /\.fresh-detail-meta\s*{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/)
  assert.doesNotMatch(css, /\.fresh-detail-meta\s*{[^}]*border-top:/)
  assert.match(css, /\.use-up\s*{[^}]*width:\s*72rpx/)
  assert.match(css, /\.fresh-recipe-row\s*{[^}]*display:\s*grid[^}]*grid-template-columns:/)
  assert.match(wxml, /wx:if="{{remainingEditorOpen}}"[^>]*class="sheet-mask remaining-editor-mask"[\s\S]*class="sheet remaining-editor"[\s\S]*编辑余量 · \{\{remainingDraft\.name\}\}[\s\S]*bindinput="onRemainingAmountInput"[\s\S]*bindchange="onRemainingUnitChange"[\s\S]*bindtap="onSaveRemaining"/)
  const remainingEditorTemplate = wxml.slice(
    wxml.indexOf('<view wx:if="{{remainingEditorOpen}}"'),
    wxml.indexOf('<view wx:if="{{showFreshForm}}"')
  )
  assert.doesNotMatch(remainingEditorTemplate, /sheet-handle/)
  assert.match(css, /\.remaining-editor-mask\s*{[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*padding:\s*32rpx/)
  assert.match(css, /\.remaining-editor\s*{[^}]*width:\s*560rpx[^}]*max-width:\s*100%[^}]*padding:\s*28rpx[^}]*border-radius:\s*26rpx/)
  assert.match(css, /\.remaining-editor \.amount-row\s*{[^}]*height:\s*68rpx[^}]*align-items:\s*center/)
  assert.match(css, /\.materials-page \.remaining-editor \.amount-row input\s*{[^}]*height:\s*68rpx[^}]*min-height:\s*68rpx[^}]*max-height:\s*68rpx[^}]*line-height:\s*68rpx[^}]*align-self:\s*center/)
  assert.match(css, /\.remaining-editor \.amount-row picker\s*{[^}]*height:\s*68rpx[^}]*align-self:\s*center/)
  assert.match(css, /\.remaining-editor \.picker-value\s*{[^}]*height:\s*68rpx[^}]*min-height:\s*68rpx[^}]*max-height:\s*68rpx[^}]*line-height:\s*68rpx/)
  assert.match(css, /\.remaining-actions\s*{[^}]*display:\s*flex[^}]*justify-content:\s*center/)
  assert.match(css, /\.materials-page \.remaining-actions button\s*{[^}]*width:\s*136rpx[^}]*min-height:\s*56rpx[^}]*font-size:\s*22rpx[^}]*line-height:\s*56rpx/)
  assert.doesNotMatch(css, /\.fresh-card\s*{[^}]*width:\s*520rpx/)
})

test('expanded fresh recipe rows navigate directly while remaining edits stay on the bar page', () => {
  let navigation = null
  const page = registeredDefinition(path.join(MINI, 'pages/materials/index.js'), {
    navigateTo(options) { navigation = options.url }
  })
  const wxml = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxml'), 'utf8')
  page.onOpenRecipe.call({}, { currentTarget: { dataset: { id: 'r1' } } })
  assert.equal(navigation, '/pages/recipe-detail/index?id=r1')

  const context = {
    data: {
      ...page.data,
      freshShelf: [{ id: 'cucumber', name: '黄瓜', remainingAmount: null, remainingUnit: null, defaultUnit: 'g' }]
    },
    setData(value) { Object.assign(this.data, value) }
  }
  page.onOpenRemainingEditor.call(context, { currentTarget: { dataset: { id: 'cucumber' } } })
  assert.equal(context.data.remainingEditorOpen, true)
  assert.equal(context.data.remainingDraft.materialId, 'cucumber')
  assert.equal(context.data.remainingDraft.remainingAmount, '')
  assert.equal(navigation, '/pages/recipe-detail/index?id=r1')

  assert.equal(page.data.recipeSheetOpen, undefined)
  assert.equal(page.onOpenFreshRecipes, undefined)
  assert.equal(page.onCloseFreshRecipes, undefined)
  assert.doesNotMatch(wxml, /class="sheet recipe-sheet"|recipeSheetRecipes|recipeSheetMaterialName/)
})

test('catalog template cards resolve a material id and open the same detail page as saved cards', () => {
  const materialsPage = fs.readFileSync(path.join(MINI, 'pages/materials/index.js'), 'utf8')
  assert.match(materialsPage, /ensureLibraryMaterial\(repository\(\), \{ id, name, category \}\)/)
  assert.match(materialsPage, /pages\/material-detail\/index\?id=\$\{encodeURIComponent\(material\.id\)\}/)
  assert.doesNotMatch(materialsPage, /pages\/material-edit\/index\?name=/)
})

test('material editor pairs acquisition with default unit and hides material form selection', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/material-edit/index.wxml'), 'utf8')
  const page = registeredDefinition(path.join(MINI, 'pages/material-edit/index.js'))
  const pairedFields = editor.match(/<view class="two-columns">[\s\S]*?<\/view>\s*<\/view>/)[0]
  assert.deepEqual(Array.from(page.data.categoryLabels), ['基酒', '利口酒', '糖浆', '果汁/果蔬', '混合饮品', '香料', '其他'])
  assert.doesNotMatch(editor, />系统分类</)
  assert.match(editor, />分类</)
  assert.match(pairedFields, />获取方式</)
  assert.match(pairedFields, />默认用量单位</)
  assert.doesNotMatch(editor, />[^<]*\*/)
  assert.doesNotMatch(editor, />材料形态 \*</)
  assert.doesNotMatch(editor, /bindchange="onFormChange"/)
})

test('bar page swipes between material and two-column glass libraries without equipment UI', () => {
  const app = JSON.parse(fs.readFileSync(path.join(MINI, 'app.json'), 'utf8'))
  const barConfig = JSON.parse(fs.readFileSync(path.join(MINI, 'pages/materials/index.json'), 'utf8'))
  const bar = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxml'), 'utf8')
  const barCss = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxss'), 'utf8')
  const profile = fs.readFileSync(path.join(MINI, 'pages/settings/index.wxml'), 'utf8')
  assert.equal(app.tabBar.list[1].text, '吧台')
  assert.equal(barConfig.navigationBarTitleText, '我的吧台')
  assert.doesNotMatch(bar, />我的吧台</)
  assert.match(bar, /class="bar-switch"/)
  assert.match(bar, />材料</)
  assert.match(bar, />酒杯</)
  assert.match(bar, /<swiper[^>]*current="{{barTabIndex}}"[^>]*bindchange="onBarSwiperChange"/)
  assert.equal((bar.match(/<swiper-item>/g) || []).length, 2)
  assert.match(bar, /class="glass-grid"/)
  assert.match(bar, /class="glass-card"/)
  assert.doesNotMatch(bar, /状态会同步到所有酒款/)
  assert.match(bar, /{{item\.displayLabel}}/)
  assert.match(bar, /bindtap="onEditGlassware"/)
  assert.match(bar, /catchtap="onRequestDeleteGlassware"/)
  assert.match(barCss, /\.glass-grid\s*{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.doesNotMatch(profile, /酒杯|固定用具|自定义用具|onAddTool|onEditTool|onRequestDeleteTool/)
})

test('glassware delete confirmation reports recipe usage without blocking deletion', () => {
  const barScript = fs.readFileSync(path.join(MINI, 'pages/materials/index.js'), 'utf8')
  assert.match(barScript, /check\.usageCount\s*>\s*0/)
  assert.match(barScript, /\$\{check\.usageCount\}\s*款酒正在使用这个酒杯/)
  assert.doesNotMatch(barScript, /正在被配方使用的酒杯不能删除/)
  assert.match(barScript, /orchestrateGlasswareMediaDelete\(\{[^}]*confirmed:\s*true/)
})

test('recipe editor opens a dedicated two-column glassware selection page with inline add', () => {
  const app = JSON.parse(fs.readFileSync(path.join(MINI, 'app.json'), 'utf8'))
  assert.ok(app.pages.includes('pages/glass-select/index'))
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  const picker = fs.readFileSync(path.join(MINI, 'pages/glass-select/index.wxml'), 'utf8')
  const pickerCss = fs.readFileSync(path.join(MINI, 'pages/glass-select/index.wxss'), 'utf8')
  const barCss = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxss'), 'utf8')
  const pickerConfig = JSON.parse(fs.readFileSync(path.join(MINI, 'pages/glass-select/index.json'), 'utf8'))
  assert.equal(pickerConfig.navigationBarTitleText, '选择酒杯')
  assert.doesNotMatch(editor, /<picker[^>]*bindchange="onGlassware"/)
  assert.match(editor, /bindtap="onOpenGlasswareSelect"/)
  assert.match(picker, /暂不选择酒杯/)
  assert.match(picker, /class="glass-grid"/)
  assert.match(picker, /bindtap="onSelectGlassware"/)
  assert.match(picker, /class="page-add"[^>]*bindtap="onAddGlassware"[^>]*>＋ 新增</)
  assert.doesNotMatch(picker, /点击酒杯后立即返回配方/)
  assert.match(picker, /wx:if="{{glassEditorOpen}}"/)
  assert.match(picker, /名称（选填）/)
  assert.match(picker, /容量 ml \*/)
  assert.match(picker, /bindtap="onSaveGlassware"/)
  assert.doesNotMatch(picker, /编辑|删除|onEditGlassware|onRequestDeleteGlassware/)
  assert.match(pickerCss, /\.glass-grid\s*{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(pickerCss, /\.page-add\s*{[^}]*height:\s*64rpx[^}]*padding:\s*0 20rpx[^}]*background:\s*#242321[^}]*border-radius:\s*999rpx/)
  assert.match(barCss, /\.materials-page \.pane-add\s*{[^}]*height:\s*64rpx[^}]*padding:\s*0 20rpx[^}]*background:\s*#242321[^}]*border-radius:\s*999rpx/)
  assert.match(pickerCss, /padding-bottom:\s*calc\(40rpx \+ env\(safe-area-inset-bottom\)\)/)
})

test('ingredient rows expose a compact long-press drag handle', () => {
  const row = fs.readFileSync(path.join(MINI, 'components/ingredient-row/index.wxml'), 'utf8')
  const rowCss = fs.readFileSync(path.join(MINI, 'components/ingredient-row/index.wxss'), 'utf8')
  assert.match(row, /class="drag-handle"[^>]*bindlongpress="onDragStart"[^>]*catchtouchmove="onDragMove"/)
  assert.match(row, />≡</)
  assert.match(rowCss, /\.drag-handle\s*\{[^}]*width:\s*32rpx/)
})

test('recipe editor renders multiple compact advance cards and prepared serving rows', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  const editorCss = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxss'), 'utf8')
  const detail = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  assert.match(editor, /class="material-stage-switch"/)
  assert.match(editor, />饮用时</)
  assert.match(editor, />提前准备</)
  assert.match(editor, /wx:for="{{advanceCards}}"[^>]*wx:key="id"[^>]*class="advance-card"/)
  assert.match(editor, /bindtap="onCreateAdvancePreparation"/)
  assert.doesNotMatch(editor, /还没有提前准备|class="advance-empty"/)
  assert.match(editor, />预调成品名称</)
  const advanceName = editor.match(/<input[^>]*class="advance-name"[^>]*>/)[0]
  assert.match(advanceName, /data-field="outputName"/)
  assert.doesNotMatch(advanceName, /placeholder=/)
  assert.doesNotMatch(editor, /internal-output-row|（本配方预制）|不加入材料库/)
  assert.match(editor, /class="advance-card-delete"[^>]*bindtap="onRemoveAdvancePreparation"/)
  assert.match(editor, /class="add-advance"[^>]*bindtap="onCreateAdvancePreparation"/)
  assert.match(editor, /class="advance-name"[\s\S]*class="shortcut advance-add-material"[\s\S]*class="ingredient-list advance-ingredients"/)
  assert.doesNotMatch(editorCss, /\.edit-page \.advance-add-material\s*\{[^}]*min-height:\s*40rpx/)
  assert.match(editor, /bindtap="onRemoveAdvancePreparation"/)
  assert.match(editor, />制作方式</)
  assert.match(editorCss, /\.material-stage-switch\s*\{[^}]*display:\s*flex/)
  assert.match(editorCss, /\.material-stage-switch\s*\{[^}]*border-bottom:\s*1rpx solid #e7e4dd/)
  assert.match(editorCss, /\.material-stage\.selected::before\s*\{[^}]*height:\s*4rpx[^}]*background:\s*#242321/)
  assert.doesNotMatch(editorCss, /\.material-stage\.selected\s*\{[^}]*background:\s*#242321/)
  assert.match(detail, /wx:for="{{detail\.ingredients}}"/)
  assert.match(detail, /<block wx:if="{{item\.preparation}}">[\s\S]*class="advance-group"[\s\S]*class="advance-summary"[\s\S]*class="advance-inline-ingredients"/)
  assert.doesNotMatch(detail, /wx:for="{{detail\.advancePreparations}}"|>提前准备 ·/)
  assert.match(editorCss, /\.advance-card\s*\{[^}]*background:\s*#f1f0ec/)
  assert.match(editorCss, /\.advance-name\s*\{[^}]*height:\s*52rpx[^}]*padding:\s*0 8rpx/)
  assert.match(editorCss, /\.edit-page \.advance-add-material\s*\{[^}]*background:\s*#ffffff[^}]*border-color:\s*#e7e4dd/)
  assert.match(editorCss, /\.advance-card-actions\s*\{[^}]*justify-content:\s*flex-end/)
  assert.match(editorCss, /\.edit-page \.advance-card-delete\s*\{[^}]*width:\s*104rpx[^}]*min-height:\s*48rpx/)
  assert.match(editorCss, /\.add-advance\s*\{[^}]*display:\s*inline-flex[^}]*width:\s*auto[^}]*min-height:\s*38rpx[^}]*padding:\s*0 6rpx/)
})

test('recipe detail nests advance materials and independently toggles non-empty steps', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-detail/index.js'))
  const template = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxss'), 'utf8')
  const context = {
    data: { ...page.data, expandedPreparationIds: {} },
    setData(value) { Object.assign(this.data, value) }
  }

  assert.deepEqual(JSON.parse(JSON.stringify(page.data.expandedPreparationIds)), {})
  page.onTogglePreparationSteps.call(context, { currentTarget: { dataset: { preparationId: 'prep-a' } } })
  assert.equal(context.data.expandedPreparationIds['prep-a'], true)
  page.onTogglePreparationSteps.call(context, { currentTarget: { dataset: { preparationId: 'prep-b' } } })
  assert.equal(context.data.expandedPreparationIds['prep-a'], true)
  assert.equal(context.data.expandedPreparationIds['prep-b'], true)
  page.onTogglePreparationSteps.call(context, { currentTarget: { dataset: { preparationId: 'prep-a' } } })
  assert.equal(context.data.expandedPreparationIds['prep-a'], false)
  assert.equal(context.data.expandedPreparationIds['prep-b'], true)

  assert.match(template, /class="advance-group"[\s\S]*class="advance-summary"[\s\S]*class="ingredient-row prepared {{item\.state}}"[\s\S]*class="advance-inline-ingredients"[\s\S]*wx:for="{{item\.preparation\.ingredients}}"[\s\S]*class="advance-steps-toggle"[\s\S]*class="advance-steps"/)
  assert.match(template, /wx:if="{{item\.preparation\.hasSteps}}"[^>]*class="advance-steps-toggle"[^>]*bindtap="onTogglePreparationSteps"/)
  assert.match(template, /class="advance-steps-toggle"[^>]*>\s*制作步骤\s*<\/view>/)
  assert.doesNotMatch(template, /▶|▼|advance-step-index/)
  assert.match(template, /wx:if="{{expandedPreparationIds\[item\.preparation\.id\]}}"[^>]*class="advance-steps"/)
  assert.match(css, /\.advance-group\s*{[^}]*margin:\s*0 0 18rpx[^}]*padding:\s*0[^}]*background:\s*rgba\(111,\s*108,\s*102,\s*\.035\)[^}]*border:\s*0[^}]*box-shadow:\s*none/)
  assert.doesNotMatch(css, /\.advance-summary\s*{[^}]*(?:background|border):/)
  assert.doesNotMatch(css, /\.advance-inline-ingredients\s*{[^}]*(?:background|border):/)
  assert.match(css, /\.advance-ingredient-row\s*{[^}]*position:\s*relative[^}]*padding:\s*0 12rpx 0 36rpx[^}]*color:\s*#77736c[^}]*border:\s*0/)
  assert.match(css, /\.advance-ingredient-row:not\(:last-child\)::after\s*{[^}]*left:\s*36rpx[^}]*right:\s*24rpx[^}]*height:\s*1rpx[^}]*background:\s*rgba\(0,\s*0,\s*0,\s*\.07\)/)
  assert.match(css, /\.advance-steps-toggle\s*{[^}]*font-size:\s*23rpx/)
  assert.doesNotMatch(css, /\.advance-step-index\s*{/)
})

test('all preparation copy uses 预调 while retaining only one internal legacy alias', () => {
  const constants = fs.readFileSync(path.join(MINI, 'domain/constants.js'), 'utf8')
  const editorModel = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/model.js'), 'utf8')
  const editorController = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.js'), 'utf8')
  const detailModel = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/model.js'), 'utf8')
  const listController = fs.readFileSync(path.join(MINI, 'pages/recipes/index.js'), 'utf8')
  assert.match(constants, /'其他预调'/)
  assert.equal((constants.match(/其他预制/g) || []).length, 1)
  assert.match(listController, /key: '其他预调', label: '其他预调'/)
  for (const source of [editorModel, editorController, detailModel]) assert.doesNotMatch(source, /预制成品|预制材料|预制方式/)
})

test('preparation editor uses one duration field with a compact hour or day unit picker', () => {
  const prep = fs.readFileSync(path.join(MINI, 'components/prep-editor/index.wxml'), 'utf8')
  const prepCss = fs.readFileSync(path.join(MINI, 'components/prep-editor/index.wxss'), 'utf8')
  assert.equal((prep.match(/<input/g) || []).length, 1)
  assert.match(prep, /class="prep-duration-text"[^>]*data-field="durationValue"/)
  assert.doesNotMatch(prep, /class="prep-duration-text"[^>]*placeholder=/)
  assert.match(prepCss, /\.prep-duration-text\s*\{[^}]*flex:\s*none[^}]*width:\s*50%/)
  assert.match(prep, /<picker[^>]*range="{{item\.units}}"[^>]*range-key="label"[^>]*bindchange="unit"/)
  assert.doesNotMatch(prep, /data-field="amount"|data-field="amountEnd"|最短|最长/)
})

test('recipe editor opens a reusable single-select material library with approved shortcut labels', () => {
  const app = JSON.parse(fs.readFileSync(path.join(MINI, 'app.json'), 'utf8'))
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  const picker = fs.readFileSync(path.join(MINI, 'pages/material-select/index.wxml'), 'utf8')
  const pickerCss = fs.readFileSync(path.join(MINI, 'pages/material-select/index.wxss'), 'utf8')
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-edit/index.js'))
  assert.ok(app.pages.includes('pages/material-select/index'))
  assert.deepEqual(Array.from(page.data.addCategories, ({ label }) => label), ['基酒', '利口酒', '果汁/果蔬', '混合饮品', '材料库'])
  assert.equal((editor.match(/bindtap="onOpenMaterialSelect"/g) || []).length, 10)
  assert.equal((editor.match(/class="[^"]*advance-add-material[^"]*"[^>]*data-stage="advance"/g) || []).length, 5)
  for (const [filter, label] of [
    ['base', '基酒'],
    ['liqueur', '利口酒'],
    ['produce', '果汁/果蔬'],
    ['mixer', '混合饮品'],
    ['all', '材料库']
  ]) {
    assert.match(editor, new RegExp(`class="[^"]*advance-add-material[^"]*"[^>]*data-stage="advance"[^>]*data-filter="${filter}"[^>]*>＋${label}<`))
  }
  assert.doesNotMatch(editor, /basePickerOpen|苏打\/汤力|>＋果汁<|>＋奶制品</)
  assert.match(picker, /placeholder="搜索材料\/快速添加材料"/)
  assert.match(picker, /class="category-tabs"[^>]*scroll-x="true"/)
  assert.match(picker, /class="material-grid"/)
  assert.match(picker, /wx:if="{{canCreateMaterial && !creatingMaterial}}"[^>]*class="create-material"/)
  assert.match(picker, /添加「{{newMaterialName}}」/)
  assert.match(picker, /wx:if="{{creatingMaterial}}"[^>]*class="create-category-panel"/)
  assert.match(picker, /wx:for="{{creationCategories}}"[^>]*bindtap="onSelectCreateCategory"/)
  assert.match(pickerCss, /\.category-tab\s*\{[^}]*height:\s*60rpx[^}]*min-height:\s*60rpx[^}]*padding:\s*0 20rpx[^}]*color:\s*#6f6c66[^}]*background:\s*#f1f0ec[^}]*border:\s*1rpx solid #e7e4dd[^}]*border-radius:\s*999rpx[^}]*font-size:\s*23rpx/)
  assert.match(pickerCss, /\.category-tab\.selected\s*\{[^}]*color:\s*#242321[^}]*background:\s*#e8e5df[^}]*border-color:\s*#d8d4cc/)
  assert.match(pickerCss, /\.material-grid\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(pickerCss, /\.create-material\s*\{[^}]*width:\s*100%[^}]*height:\s*auto[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/)
})

test('material picker requires an explicit category after tapping add', () => {
  let navigations = 0
  const emitted = []
  const page = registeredDefinition(path.join(MINI, 'pages/material-select/index.js'), { navigateBack() { navigations += 1 } })
  const context = {
    data: { ...page.data, categoryFilter: 'all', canCreateMaterial: true, newMaterialName: '神秘材料', creatingMaterial: false },
    channel: { emit(name, payload) { emitted.push([name, payload]) } },
    setData(value) { Object.assign(this.data, value) },
    finish: page.finish
  }

  page.onCreateMaterial.call(context)
  assert.equal(context.data.creatingMaterial, true)
  assert.deepEqual(emitted, [])
  assert.equal(navigations, 0)
  assert.equal(typeof page.onSelectCreateCategory, 'function')

  page.onSelectCreateCategory.call(context, { currentTarget: { dataset: { category: 'other' } } })
  assert.deepEqual(JSON.parse(JSON.stringify(emitted)), [['material:selected', { material: { name: '神秘材料', category: 'other', isNew: true } }]])
  assert.equal(navigations, 1)
})

test('material picker only offers adding a searched name when no exact material exists', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/material-select/index.js'))
  const context = {
    data: { categoryFilter: 'all', query: '紫苏糖浆', materials: [] },
    setData(value) { Object.assign(this.data, value) }
  }
  page.reload.call(context)
  assert.equal(context.data.canCreateMaterial, true)
  assert.equal(context.data.newMaterialName, '紫苏糖浆')

  context.data.categoryFilter = 'liqueur'
  context.data.query = '金酒'
  page.reload.call(context)
  assert.equal(context.data.categoryFilter, 'liqueur')
  assert.equal(context.data.materials.some(({ name }) => name === '金酒'), true)
  assert.equal(context.data.canCreateMaterial, false)
})

test('material shortcut sends its category and appends the single returned selection', () => {
  let navigateOptions
  const handlers = {}; const emitted = []
  const eventChannel = { on(name, handler) { handlers[name] = handler }, emit(name, payload) { emitted.push([name, payload]) } }
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-edit/index.js'), { navigateTo(options) { navigateOptions = options; options.success({ eventChannel }) } })
  const context = {
    data: { form: { ...page.data.form, ingredients: [] }, errors: {} },
    glassware: [], tools: [],
    sync(form) { this.savedForm = form }
  }
  page.onOpenMaterialSelect.call(context, { currentTarget: { dataset: { filter: 'produce' } } })
  assert.equal(navigateOptions.url, '/pages/material-select/index?categoryFilter=produce')
  assert.deepEqual(JSON.parse(JSON.stringify(emitted)), [['material-select:init', { categoryFilter: 'produce' }]])
  handlers['material:selected']({ material: { id: 'pineapple', name: '菠萝', category: 'fruit', defaultUnit: 'g', alcoholic: false } })
  assert.equal(context.savedForm.ingredients[0].materialId, 'pineapple')
})

test('material picker reads its initial category from the route before rendering', () => {
  const picker = registeredDefinition(path.join(MINI, 'pages/material-select/index.js'))
  const context = {
    data: { ...picker.data },
    setData(value) { Object.assign(this.data, value) },
    reload: picker.reload
  }

  picker.onLoad.call(context, { categoryFilter: 'produce' })

  assert.equal(context.data.categoryFilter, 'produce')
})

test('replacing an ingredient opens the material library on that ingredient category tab', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-edit/index.js'))
  const opened = []
  const context = {
    data: {
      form: {
        ingredients: [{ category: 'citrus' }],
        advancePreparations: [{ id: 'prep-a', ingredients: [{ category: 'liqueur' }] }]
      }
    },
    onOpenMaterialSelect(event) { opened.push(event.detail) }
  }

  page.onPickName.call(context, { detail: { index: 0 } })
  page.onPickAdvanceName.call(context, { detail: { index: 0, preparationId: 'prep-a' } })

  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [
    { index: 0, categoryFilter: 'produce' },
    { index: 0, preparationId: 'prep-a', categoryFilter: 'liqueur', stage: 'advance' }
  ])
})

test('advance material picker appends one selection to the requested preparation card', () => {
  const handlers = {}
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-edit/index.js'), { navigateTo(options) { options.success({ eventChannel: { on(name, handler) { handlers[name] = handler }, emit() {} } }) } })
  const form = {
    ...page.data.form,
    ingredients: [],
    advancePreparations: [
      { id: 'prep-a', outputName: 'A', ingredients: [], steps: '' },
      { id: 'prep-b', outputName: 'B', ingredients: [], steps: '' }
    ]
  }
  const context = { data: { form, errors: {}, materialStage: 'advance' }, sync(next) { this.savedForm = next } }
  page.onOpenMaterialSelect.call(context, { currentTarget: { dataset: { stage: 'advance', preparationId: 'prep-b', index: -1, filter: 'all' } } })
  handlers['material:selected']({ material: { id: 'rum', name: '白朗姆', category: 'base-spirit', defaultUnit: 'ml', alcoholic: true, abv: 40 } })
  assert.equal(context.savedForm.advancePreparations[0].ingredients.length, 0)
  assert.equal(context.savedForm.advancePreparations[1].ingredients[0].materialId, 'rum')
})

test('adding an advance preparation preserves the current instant preparation choice', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-edit/index.js'))
  const context = {
    data: { form: page.data.form, errors: {} },
    setData(value) { Object.assign(this.data, value) },
    sync(form) { this.savedForm = form }
  }
  page.onCreateAdvancePreparation.call(context)
  assert.deepEqual(JSON.parse(JSON.stringify(context.savedForm.preparations.map(({ type }) => type))), ['即调'])
  assert.equal(context.savedForm.advancePreparations.length, 1)
})

test('recipe glassware navigation sends the current id and only changes that field on selection', () => {
  let navigateOptions = null
  let navigateCalls = 0
  const handlers = {}
  const emitted = []
  const eventChannel = {
    on(name, handler) { handlers[name] = handler },
    emit(name, payload) { emitted.push([name, payload]) }
  }
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-edit/index.js'), {
    navigateTo(options) { navigateCalls += 1; navigateOptions = options; options.success({ eventChannel }) }
  })
  const original = { name: '草稿酒', source: '家中', glasswareId: 'g1', ingredients: [{ name: '金酒' }] }
  const context = {
    data: { form: original, errors: { equipment: '旧提示' } },
    sync(form, errors) { this.synced = { form, errors } }
  }
  page.onOpenGlasswareSelect.call(context)
  page.onOpenGlasswareSelect.call(context)
  assert.equal(navigateCalls, 1)
  assert.equal(navigateOptions.url, '/pages/glass-select/index')
  assert.deepEqual(JSON.parse(JSON.stringify(emitted)), [['glassware:init', { selectedId: 'g1' }]])
  handlers['glassware:selected']({ glasswareId: 'g2' })
  assert.deepEqual(JSON.parse(JSON.stringify(context.synced.form)), { ...original, glasswareId: 'g2' })
  assert.deepEqual(context.synced.errors, { equipment: '旧提示' })
})

test('all material availability and optional tracking are controlled from detail while editor actions share one row', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/material-edit/index.wxml'), 'utf8')
  const editorScript = fs.readFileSync(path.join(MINI, 'pages/material-edit/index.js'), 'utf8')
  const detail = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.wxml'), 'utf8')
  const editorCss = fs.readFileSync(path.join(MINI, 'pages/material-edit/index.wxss'), 'utf8')
  assert.doesNotMatch(editor, />当前我有</)
  assert.doesNotMatch(editor, />当前在手头</)
  assert.doesNotMatch(editor, /bindchange="onOwnedChange"/)
  assert.doesNotMatch(editor, /bindchange="onFreshChange"/)
  assert.doesNotMatch(editorScript, /onFreshChange\s*\(/)
  assert.doesNotMatch(editor, /checked="{{form\.trackFreshness}}"|bindchange="onTrackChange"/)
  assert.match(detail, /class="availability-row"/)
  assert.match(detail, /<switch[^>]*checked="{{detail\.available}}"[^>]*bindchange="onToggleAvailable"/)
  assert.match(detail, /wx:if="{{detail\.canToggleTracking}}"[^>]*class="tracking-row"/)
  assert.match(detail, /<switch[^>]*checked="{{detail\.trackFreshness}}"[^>]*bindchange="onToggleTracking"/)
  assert.doesNotMatch(detail, /更新追踪信息|onOpenTrackingForm|showFreshForm|sheet-mask/)
  assert.match(detail, /wx:if="{{detail\.canEditTracking}}" class="tracking-details"/)
  assert.match(detail, /class="tracking-detail-label">购买日期<\/text>/)
  assert.match(detail, /class="tracking-detail-label">剩余量<\/text>/)
  assert.match(detail, /class="tracking-detail-label">预计过期日<\/text>/)
  assert.match(detail, /bindblur="onTrackingAmountBlur"/)
  assert.match(detail, /bindchange="onTrackingUnitChange"/)
  assert.match(detail, /bindchange="onTrackingExpiryChange"/)
  assert.doesNotMatch(editorScript, /onFreshChange\s*\(/)
  assert.doesNotMatch(fs.readFileSync(path.join(MINI, 'pages/material-detail/index.js'), 'utf8'), /showFreshForm|onOpenTrackingForm|onConfirmTracking/)
  assert.doesNotMatch(detail, />加入手头鲜材</)
  const actions = editor.match(/<view class="form-actions">[\s\S]*?<\/view>/)[0]
  assert.match(actions, /class="save"[^>]*>保存材料<\/button>/)
  assert.match(actions, /class="delete"[^>]*>删除材料<\/button>/)
  assert.match(editorCss, /\.form-actions\s*{[^}]*display:\s*flex[^}]*align-items:\s*stretch/)
  assert.match(editorCss, /\.form-actions \.save\s*{[^}]*flex:\s*1/)
  assert.match(editorCss, /\.form-actions \.delete\s*{[^}]*flex:\s*1/)
})

test('home collapses every filter group behind one all trigger', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/recipes/index.js'))
  const recipes = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxss'), 'utf8')

  assert.equal(page.data.filterPanelOpen, false)
  assert.match(recipes, /<view class="filter-trigger"[^>]*bindtap="toggleFilterPanel"[^>]*aria-role="button"[^>]*aria-expanded="{{filterPanelOpen}}"/)
  assert.match(recipes, /class="filter-trigger-label">全部</)
  assert.match(recipes, /class="filter-symbol \{\{prepType !== 'all' \|\| materialCondition !== 'all' \|\| rating !== 'all' \|\| untriedOnly \|\| sortKey !== 'prep-time' \? 'active' : ''\}\}"[\s\S]*class="filter-symbol-line/)
  assert.match(recipes, /class="filter-panel \{\{filterPanelOpen \? 'open' : ''\}\}"[^>]*aria-hidden="{{!filterPanelOpen}}"/)
  for (const title of ['排序依据', '制作方式', '材料条件', '评价', '调酒状态']) {
    assert.match(recipes, new RegExp(`class="filter-group-title">${title}<`))
  }
  for (const kind of ['sort', 'preparation', 'material', 'rating', 'status']) {
    assert.match(recipes, new RegExp(`data-kind="${kind}"`))
  }
  assert.match(recipes, /class="filter-reset"[^>]*bindtap="resetFilterPanel"[^>]*>重置</)
  assert.match(recipes, /class="filter-collapse"[^>]*bindtap="collapseFilterPanel"[^>]*>收起</)
  assert.doesNotMatch(recipes, /filter-grid|untried-filter-row|sheet-mask|openSortSheet|openFilter|onSelectSheet/)
  assert.equal(page.data.sortOptions[0].shortLabel, '准备最短')
  assert.equal(page.data.sortOptions.find((option) => option.key === 'recent').shortLabel, '最近')
  assert.equal(page.data.sortOptions.find((option) => option.key === 'rating').shortLabel, '评价')
  assert.equal(page.data.sortOptions.find((option) => option.key === 'name').shortLabel, '名称')
  assert.equal(page.data.prepOptions.find((option) => option.key === '低温慢煮').shortLabel, '低温')
  assert.equal(page.data.prepOptions.find((option) => option.key === '其他预调').shortLabel, '其他')
  assert.equal(page.data.statusOptions.find((option) => option.key === 'untried').shortLabel, '未调过')
  assert.match(recipes, /wx:for="{{sortOptions}}"[\s\S]*class="filter-option-label">\{\{option\.shortLabel \|\| option\.label\}\}<\/text><\/view>/)
  assert.match(css, /\.recipes-page\s*{[^}]*position:\s*relative/)
  assert.match(recipes, /class="filter-bar"[\s\S]*class="filter-trigger"[\s\S]*class="add-hit"/)
  assert.doesNotMatch(recipes, /class="topbar"|class="page-title">我的酒单</)
  assert.match(css, /\.filter-bar\s*{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*width:\s*100%/)
  assert.match(css, /\.filter-trigger\s*{[^}]*justify-content:\s*flex-start[^}]*flex:\s*1[^}]*width:\s*auto[^}]*margin-left:\s*0[^}]*text-align:\s*left/)
  assert.match(css, /\.filter-symbol\.active \.filter-symbol-line\s*{[^}]*background:\s*#957052/)
  assert.match(css, /\.filter-panel\s*{[^}]*position:\s*absolute[^}]*z-index:\s*10[^}]*right:\s*32rpx[^}]*left:\s*32rpx[^}]*max-width:\s*calc\(100vw - 64rpx\)[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*hidden[^}]*background:/)
  assert.match(css, /\.filter-option-grid\s*{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)[^}]*gap:\s*8rpx/)
  assert.match(css, /\.filter-option\s*{[^}]*min-width:\s*0[^}]*overflow:\s*hidden/)
  assert.match(css, /\.filter-option\.selected\s*{[^}]*color:[^}]*background:/)
})

test('home shows a non-interactive two-line seasonal fruit hint below search', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/recipes/index.js'))
  const script = fs.readFileSync(path.join(MINI, 'pages/recipes/index.js'), 'utf8')
  const template = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxss'), 'utf8')
  const searchIndex = template.indexOf('class="search-box"')
  const hintIndex = template.indexOf('class="seasonal-fruit-tip"')
  const filtersIndex = template.indexOf('class="filter-trigger"')

  assert.equal(page.data.seasonalFruitMessage, '')
  assert.match(script, /require\(['"]\.\.\/\.\.\/domain\/seasonal-fruits['"]\)/)
  assert.match(script, /buildSeasonalFruitMessage\(new Date\(\)\.getMonth\(\) \+ 1\)/)
  assert.ok(searchIndex >= 0 && hintIndex > searchIndex && filtersIndex > hintIndex)
  assert.match(template, /<text wx:if="{{seasonalFruitMessage}}" class="seasonal-fruit-tip">{{seasonalFruitMessage}}<\/text>/)
  assert.doesNotMatch(template.match(/<text wx:if="{{seasonalFruitMessage}}"[^>]*>/)[0], /bindtap|catchtap/)
  assert.match(css, /\.seasonal-fruit-tip\s*{[^}]*font-size:\s*22rpx[^}]*line-height:\s*1\.55[^}]*-webkit-line-clamp:\s*2/)
})

test('home filter panel applies grouped options immediately and stays open', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/recipes/index.js'))
  const context = {
    data: { ...page.data },
    refreshCount: 0,
    setData(value) { Object.assign(this.data, value) },
    refreshCards() { this.refreshCount += 1 }
  }

  page.toggleFilterPanel.call(context)
  assert.equal(context.data.filterPanelOpen, true)
  page.onSelectFilterOption.call(context, { currentTarget: { dataset: { kind: 'preparation', key: '冷冻' } } })
  assert.equal(context.data.prepType, '冷冻')
  assert.equal(context.data.filterPanelOpen, true)
  page.onSelectFilterOption.call(context, { currentTarget: { dataset: { kind: 'status', key: 'untried' } } })
  assert.equal(context.data.untriedOnly, true)
  assert.equal(context.refreshCount, 2)
  page.resetFilterPanel.call(context)
  assert.equal(context.data.prepType, 'all')
  assert.equal(context.data.untriedOnly, false)
  assert.equal(context.data.filterPanelOpen, true)
  assert.equal(context.refreshCount, 3)
  page.collapseFilterPanel.call(context)
  assert.equal(context.data.filterPanelOpen, false)
})

test('expanded home filter overlays the visible recipe list while locking page scrolling', () => {
  const template = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxss'), 'utf8')

  assert.match(template, /class="page recipes-page \{\{filterPanelOpen \? 'filter-open' : ''\}\}"/)
  assert.match(template, /wx:if="{{filterPanelOpen}}"[^>]*class="filter-scroll-lock"[^>]*catchtap="collapseFilterPanel"[^>]*catchtouchmove="noop"[^>]*aria-label="点击空白处收起筛选"/)
  assert.match(template, /class="filter-panel \{\{filterPanelOpen \? 'open' : ''\}\}"[^>]*catchtouchmove="noop"[^>]*aria-hidden="{{!filterPanelOpen}}"/)
  assert.doesNotMatch(template, /wx:if="{{filterPanelOpen}}"[^>]*class="filter-panel"/)
  assert.match(template, /wx:if="{{recipes\.length}}"[^>]*class="card-list"/)
  assert.match(template, /wx:elif="{{hasRecipes}}"[^>]*class="empty no-results"/)
  assert.match(template, /wx:else[^>]*class="empty"/)
  assert.doesNotMatch(template, /!filterPanelOpen && (?:recipes\.length|hasRecipes)/)
  assert.doesNotMatch(template, /scroll-x|scroll-y/)
  assert.match(css, /\.filter-scroll-lock\s*{[^}]*position:\s*fixed[^}]*z-index:\s*8[^}]*inset:\s*0/)
  assert.match(css, /\.recipes-page\.filter-open\s*{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/)
  assert.match(css, /\.filter-bar\s*{[^}]*position:\s*relative[^}]*z-index:\s*11/)
  assert.match(css, /\.filter-panel\s*{[^}]*opacity:\s*0[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none[^}]*transform:[^;}]*translateY\([^)]*\)[^}]*transition:/)
  assert.match(css, /\.filter-panel\.open\s*{[^}]*opacity:\s*1[^}]*visibility:\s*visible[^}]*pointer-events:\s*auto[^}]*transform:\s*translateY\(0\)\s*scale\(\s*1\s*\)/)
})

test('home filter option labels stay inside their own narrow-screen grid cells', () => {
  const template = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxss'), 'utf8')

  assert.match(template, /<view wx:for="{{sortOptions}}"[^>]*class="filter-option[^>]*aria-role="button"[^>]*>[\s\S]*?<text class="filter-option-label">\{\{option\.shortLabel \|\| option\.label\}\}<\/text><\/view>/)
  assert.doesNotMatch(template, /<button wx:for="{{(?:sort|prep|material|rating|status)Options}}"[^>]*class="filter-option/)
  assert.match(css, /\.filter-option-label\s*{[^}]*box-sizing:\s*border-box[^}]*display:\s*block[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*overflow:\s*hidden[^}]*font-size:\s*20rpx[^}]*white-space:\s*nowrap[^}]*text-align:\s*center/)
})

test('home uses the same labeled dark pill add button as the bar page', () => {
  const template = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxss'), 'utf8')
  assert.match(template, /class="filter-bar"[\s\S]*class="filter-trigger"[\s\S]*<button size="mini" class="add-hit" bindtap="onAddRecipe" aria-label="添加一款酒">＋ 新增<\/button>/)
  assert.doesNotMatch(template, /class="add-button"/)
  assert.match(css, /\.add-hit\s*{[^}]*flex:\s*none[^}]*width:\s*auto[^}]*height:\s*64rpx[^}]*min-height:\s*64rpx[^}]*margin:\s*0[^}]*padding:\s*0 20rpx[^}]*color:\s*#ffffff[^}]*background:\s*#242321[^}]*border-radius:\s*999rpx[^}]*font-size:\s*21rpx[^}]*line-height:\s*64rpx/)
  assert.match(css, /\.add-hit::after[^}]*{[^}]*border:\s*0/)
  assert.doesNotMatch(css, /linear-gradient\(145deg,\s*#bd7b31,\s*#9d5f22\)/)
})

test('recipe cards place a distinct ABV badge after the preparation badge', () => {
  const card = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxss'), 'utf8')
  assert.match(card, /class="recipe-meta"[\s\S]*class="prep-label"[\s\S]*class="abv-label"/)
  assert.match(card, /wx:if="{{recipe\.abvLabel}}"[^>]*class="abv-label"/)
  assert.match(css, /\.recipe-meta\s*{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*flex-wrap:\s*wrap/)
  assert.match(css, /\.abv-label\s*{[^}]*color:\s*#[0-9a-fA-F]{6}[^}]*background:\s*#[0-9a-fA-F]{6}/)
})

test('recipe detail ratings keep the original tag sizing while saving directly', () => {
  const template = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  const controller = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.js'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxss'), 'utf8')
  assert.match(template, /<text[^>]*data-rating="\{\{item\.label\}\}"[^>]*bindtap="onToggleRating"[^>]*class="rating-option[^>]*aria-role="button"/)
  assert.doesNotMatch(template, /<button[^>]*class="rating-option/)
  assert.match(template, /aria-label="\{\{item\.label\}\}\{\{item\.selected \? '，已选择，再点取消' : '，点按评价'\}\}"/)
  assert.match(controller, /onToggleRating\(event\)/)
  assert.match(controller, /orchestrateRatingToggle/)
  assert.match(css, /\.rating-option\s*{[^}]*color:\s*#6f6c66[^}]*background:\s*#f1f0ec/)
  assert.doesNotMatch(css, /\.detail-page \.ratings \.rating-option/)
})

test('recipe detail shows combined notes only in the notes section', () => {
  const template = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxss'), 'utf8')
  assert.doesNotMatch(template, /detail\.tastingNote|暂未记录总体备注/)
  assert.doesNotMatch(css, /\.tasting-note/)
  assert.match(template, /<text class="section-title">备注<\/text>[\s\S]*wx:for="\{\{detail\.steps\}\}"/)
})

test('recipe cards distinguish prepared outputs with a quiet neutral ingredient label', () => {
  const card = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxss'), 'utf8')
  assert.match(card, /class="ingredient \{\{item\.state\}\}"/)
  assert.match(css, /\.ingredient\.prepared\s*{[^}]*color:\s*#[0-9a-fA-F]{6}[^}]*background:\s*#[0-9a-fA-F]{6}[^}]*border-color:\s*#[0-9a-fA-F]{6}/)
})

test('recipe cards identify untried recipes in the rating position', () => {
  const card = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxss'), 'utf8')
  assert.match(card, /wx:if="{{recipe\.untriedLabel}}"[^>]*class="untried-label"[^>]*>{{recipe\.untriedLabel}}/)
  assert.match(card, /wx:elif="{{recipe\.rating}}"[^>]*class="rating"/)
  assert.match(css, /\.untried-label\s*{[^}]*color:\s*#6f6c66[^}]*background:\s*#f1f0ec/)
})

test('recipe page builds a null-prototype material lookup for legacy-safe ids', () => {
  const page = fs.readFileSync(path.join(MINI, 'pages/recipes/index.js'), 'utf8')
  assert.match(page, /materialsById:[\s\S]*?\.reduce\([\s\S]*?,\s*Object\.create\(null\)\)/)
})

test('home distinguishes a genuinely empty collection from filtered no-results and can clear filters', () => {
  const recipes = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxml'), 'utf8')
  assert.match(recipes, /wx:elif="{{hasRecipes}}" class="empty no-results"/)
  assert.match(recipes, /wx:else class="empty"/)
  assert.match(recipes, /bindtap="clearFilters"/)
  assert.match(recipes, /没有符合条件的酒/)
})

test('recipe entry uses library-backed material shortcuts and no manual alcoholic switch', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  const ingredient = fs.readFileSync(path.join(MINI, 'components/ingredient-row/index.wxml'), 'utf8')
  assert.match(editor, />＋基酒</)
  assert.doesNotMatch(editor, /basePickerOpen|quickBases/)
  assert.doesNotMatch(editor, /alcoholicchange/)
  assert.doesNotMatch(ingredient, /<switch/)
  assert.doesNotMatch(ingredient, />含酒精</)
})

test('recipe editor script starts with executable source rather than stray route text', () => {
  const controller = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.js'), 'utf8')
  assert.doesNotMatch(controller, /^pages\//)
})

test('recipe entry keeps ratings scrollable while compact material shortcuts wrap', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxss'), 'utf8')
  assert.match(editor, /class="rating-scroll"[^>]*scroll-x="true"/)
  assert.doesNotMatch(editor, /<text wx:if="{{form\.rating === item}}">✓ <\/text>/)
  assert.match(editor, /<view[^>]*class="material-shortcuts">/)
  assert.doesNotMatch(editor, /class="material-shortcuts"[^>]*scroll-x=/)
  assert.match(css, /\.shortcut-track\s*{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/)
})

test('each recipe material stage exposes the same five approved material-library shortcuts', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-edit/index.js'))
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  assert.deepEqual(Array.from(page.data.addCategories, (item) => item.label), ['基酒', '利口酒', '果汁/果蔬', '混合饮品', '材料库'])
  assert.equal((editor.match(/<button[^>]*size="mini"[^>]*class="shortcut(?: advance-add-material)?"/g) || []).length, 10)
  assert.doesNotMatch(editor, /class="shortcut primary/)
  for (const filter of ['base', 'liqueur', 'produce', 'mixer', 'all']) {
    assert.equal((editor.match(new RegExp(`data-filter="${filter}"`, 'g')) || []).length, 2)
  }
})

test('recipe ingredient suggestions show ordinary syrup once using its short name', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-edit/index.js'))
  const context = {
    data: { form: { ingredients: [{ category: 'syrup/staple' }] } },
    materials: [
      { id: 'ordinary-a', name: '普通糖浆', category: 'syrup/staple' },
      { id: 'ordinary-b', name: '普通糖浆', category: 'syrup/staple' },
      { id: 'honey', name: '蜂蜜糖浆', category: 'syrup/staple' }
    ]
  }
  const suggestions = page.suggestionsFor.call(context, 0, '')

  assert.equal(suggestions.filter(({ name }) => name === '糖浆').length, 1)
  assert.equal(suggestions.some(({ name }) => name === '普通糖浆'), false)
  assert.equal(suggestions.find(({ name }) => name === '糖浆').id, 'ordinary-a')
})

test('recipe ingredient rows fit one screen without metadata, ABV, notes or a separate search button', () => {
  const ingredient = fs.readFileSync(path.join(MINI, 'components/ingredient-row/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'components/ingredient-row/index.wxss'), 'utf8')
  assert.doesNotMatch(ingredient, /ingredient-scroll|class="pick"|class="category|class="abv-|class="observation|change-hint/)
  assert.match(ingredient, /class="name/)
  assert.match(ingredient, /class="amount"/)
  const amountInput = ingredient.match(/<input[^>]*class="amount"[^>]*>/)[0]
  assert.match(amountInput, /wx:if="{{item\.unit !== 'to-taste' && item\.unit !== 'top-up'}}"/)
  assert.match(amountInput, /type="text"/)
  assert.match(ingredient, /class="unit"/)
  assert.match(ingredient, /class="remove"/)
  assert.match(ingredient, /<button[^>]*size="mini"[^>]*class="remove"/)
  assert.match(css, /\.row-track\s*{[^}]*display:\s*flex[^}]*width:\s*100%/)
  assert.match(css, /\.name\s*{[^}]*flex:\s*1[^}]*min-width:\s*0[^}]*padding:\s*0 8rpx/)
  assert.match(css, /\.unit-picker\s*{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*height:\s*60rpx[^}]*min-height:\s*60rpx/)
})

test('recipe preparation, equipment and notes show only the requested compact fields', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  const prep = fs.readFileSync(path.join(MINI, 'components/prep-editor/index.wxml'), 'utf8')
  const prepCss = fs.readFileSync(path.join(MINI, 'components/prep-editor/index.wxss'), 'utf8')
  assert.doesNotMatch(prep, /prep-note|prep-row-scroll/)
  assert.match(prep, /<button[^>]*size="mini"[^>]*class="chip/)
  assert.doesNotMatch(prep, /✓/)
  assert.match(prepCss, /\.chips\s*{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/)
  assert.match(prepCss, /\.chip\.selected\s*{[^}]*box-shadow:/)
  assert.doesNotMatch(editor, /tool-scroll|capacity-line|preview\.capacity|class="warning"/)
  assert.match(editor, /class="select"/)
  assert.doesNotMatch(editor, /class="select"[^>]*>[\s\S]*?›[\s\S]*?<\/view>/)
  assert.match(editor, /class="abv-row"/)
  assert.match(editor, /wx:if="{{preview\.abvHint}}"[^>]*class="abv-hint"/)
  assert.equal((editor.match(/<textarea\b/g) || []).length, 2)
  assert.match(editor, /<textarea[^>]*data-field="steps"[^>]*>/)
  assert.match(editor, /<textarea[^>]*class="advance-steps"[^>]*data-field="steps"/)
  assert.doesNotMatch(editor, /<textarea[^>]*placeholder=/)
  assert.doesNotMatch(editor, /data-field="tastingNote"/)
  assert.match(fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxss'), 'utf8'), /\.note-input\s*{[^}]*height:\s*96rpx[^}]*min-height:\s*96rpx/)
})

test('all user-facing mini-program copy calls glassware 酒杯 instead of 杯具', () => {
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
    for (const file of walk(MINI, extension)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /杯具/, path.relative(ROOT, file))
  }
})

test('recipe entry uses compact section and full-width basic fields', () => {
  const editorCss = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxss'), 'utf8')
  const ingredientCss = fs.readFileSync(path.join(MINI, 'components/ingredient-row/index.wxss'), 'utf8')
  const prepCss = fs.readFileSync(path.join(MINI, 'components/prep-editor/index.wxss'), 'utf8')
  assert.match(editorCss, /\.section\s*{[^}]*padding:\s*14rpx 12rpx/)
  assert.match(editorCss, /\.section-heading\s*{[^}]*width:\s*100%/)
  assert.match(editorCss, /\.tried-toggle\s*{[^}]*flex:\s*none[^}]*margin-left:\s*auto/)
  assert.match(editorCss, /\.basic-fields\s*{[^}]*width:\s*100%/)
  assert.doesNotMatch(editorCss, /\.image-button|\.image-placeholder|\.image-plus/)
  const ingredientHeight = Number(ingredientCss.match(/\.name,[^}]*min-height:\s*(\d+)rpx/)[1])
  const prepHeight = Number(prepCss.match(/\.chip\.chip\s*{[^}]*min-height:\s*(\d+)rpx/)[1])
  assert.ok(ingredientHeight <= 64)
  assert.ok(prepHeight <= 64)
})

test('recipe entry relies on native page scrolling so its nested horizontal rails remain visible', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxss'), 'utf8')
  assert.match(editor, /^<view class="edit-page">/)
  assert.doesNotMatch(editor, /<scroll-view class="edit-page"[^>]*scroll-y="true"/)
  assert.match(css, /\.edit-page\s*{[^}]*min-height:\s*100vh/)
})

test('recipe entry gives changing ingredient and material selection rows stable data-backed keys', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  const picker = fs.readFileSync(path.join(MINI, 'pages/material-select/index.wxml'), 'utf8')
  assert.match(editor, /wx:for="{{formIngredients}}"\s+wx:key="renderKey"/)
  assert.match(editor, /wx:for="{{preparation\.formIngredients}}"[^>]*wx:key="renderKey"/)
  assert.match(picker, /wx:for="{{materials}}"\s+wx:key="renderKey"/)
  assert.doesNotMatch(editor, /wx:for="{{(?:formIngredients|preparation\.formIngredients)}}"[^>]*wx:key="index"/)
})

test('recipe entry keeps ingredient keys stable through material replacement', () => {
  let navigateOptions
  const handlers = {}
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-edit/index.js'), { navigateTo(options) { navigateOptions = options; options.success({ eventChannel: { on(name, handler) { handlers[name] = handler }, emit() {} } }) } })
  const original = page.data.form.ingredients[0]
  const context = { data: { form: page.data.form, errors: {}, materialStage: 'serving' }, sync(form) { this.form = form } }
  page.onOpenMaterialSelect.call(context, { currentTarget: { dataset: { index: 0, filter: 'all' } } })
  assert.equal(navigateOptions.url, '/pages/material-select/index')
  handlers['material:selected']({ material: { id: 'm-lime', name: '青柠汁', category: 'citrus', defaultUnit: 'ml' } })
  assert.equal(context.form.ingredients[0].renderKey, original.renderKey)
})

test('compact horizontal controls retain the existing 88rpx touch target contract', () => {
  const homeCss = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxss'), 'utf8')
  const ingredientCss = fs.readFileSync(path.join(MINI, 'components/ingredient-row/index.wxss'), 'utf8')
  const prepCss = fs.readFileSync(path.join(MINI, 'components/prep-editor/index.wxss'), 'utf8')
  const filterHeight = Number(homeCss.match(/\.filter-trigger[^}]*min-height:\s*(\d+)rpx/)[1])
  const sortHeight = Number(homeCss.match(/\.filter-option[^}]*min-height:\s*(\d+)rpx/)[1])
  assert.ok(filterHeight >= 88)
  assert.ok(sortHeight >= 56)
  assert.match(ingredientCss, /\.remove\.remove\s*{[^}]*width:\s*44rpx[^}]*height:\s*60rpx[^}]*min-height:\s*60rpx/)
  assert.match(prepCss, /\.chips\s*{[^}]*column-gap:\s*10rpx[^}]*row-gap:\s*8rpx/)
  assert.match(prepCss, /\.chip\.chip\s*{[^}]*flex:\s*0 0 calc\(\(100% - 20rpx\) \/ 3\)[^}]*width:\s*auto[^}]*min-height:\s*56rpx[^}]*padding:\s*0 12rpx/)
})

test('mini program templates do not render the down-chevron glyph', () => {
  for (const relative of walk(MINI, '.wxml')) {
    assert.doesNotMatch(fs.readFileSync(relative, 'utf8'), /⌄/, relative)
  }
})

test('every editable form exposes validation feedback inside the form', () => {
  const expected = new Map([
    ['pages/recipe-edit/index.wxml', /errors\./],
    ['pages/material-edit/index.wxml', /errors\./],
    ['pages/recipe-detail/index.wxml', /manualAbvError/],
    ['pages/materials/index.wxml', /freshError[\s\S]*glassError|glassError[\s\S]*freshError/],
    ['pages/material-detail/index.wxml', /freshError/]
  ])
  for (const [relative, marker] of expected) assert.match(fs.readFileSync(path.join(MINI, relative), 'utf8'), marker, relative)
})

test('recipe entry omits image selection while preserving legacy image data', () => {
  const template = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.js'), 'utf8')
  const model = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/model.js'), 'utf8')
  assert.doesNotMatch(template, /image-button|recipe-image|image-placeholder|选择配方图片|图片处理中/)
  assert.doesNotMatch(editor, /chooseMedia|onChooseImage|persistRecipeImage|savingImage|imageError/)
  assert.match(model, /imagePath:\s*''/)
  assert.match(model, /imagePath:\s*form\.imagePath\s*\|\|\s*''/)
})

test('recipe detail ingredient rows navigate to their material detail', () => {
  const detail = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  assert.match(detail, /class="ingredient-row[^>]*data-id="{{item\.materialId}}"[^>]*bindtap="onOpenMaterial"/)
})

test('recipe detail uses compact meta tags and folds glassware into the material heading', () => {
  const wxml = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxss'), 'utf8')
  assert.match(wxml, /<text class="abv-badge"[^>]*bindtap="onOpenManualAbv"[^>]*>{{detail\.abvBadgeLabel}}<\/text>/)
  assert.match(wxml, /class="section-heading"[\s\S]*class="section-title">材料<\/text>[\s\S]*class="material-glassware"/)
  assert.match(wxml, /class="ingredient-name">{{item\.name}}<\/text><text wx:if="{{item\.state === 'quick-buy'}}" class="quick-buy-icon"[^>]*>🛍️<\/text>/)
  assert.doesNotMatch(wxml, /class="row-arrow"|>酒杯与用具</)
  assert.doesNotMatch(css, /\.ingredient-row\.quick-buy\s*{[^}]*background/)
  assert.match(css, /\.abv-badge\s*{[^}]*min-height:\s*48rpx[^}]*padding:\s*0 18rpx[^}]*color:\s*#536274[^}]*background:\s*#ebeff3[^}]*border:\s*1rpx solid #dbe2e9/)
  assert.match(wxml, /bindinput="onManualAbvInput"/)
  assert.match(wxml, /bindtap="onSaveManualAbv"/)
  assert.match(wxml, /bindtap="onClearManualAbv"/)
  assert.doesNotMatch(wxml, /预估酒精度|预计总体积|总体积信息不完整|detail\.capacity|calculation-notice|onEditMissingAbv/)
})

test('material observations are added and edited only from material detail', () => {
  const material = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.wxml'), 'utf8')
  const materialScript = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.js'), 'utf8')
  const recipe = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  assert.match(material, /class="observation-heading"[\s\S]*class="section-title">我的材料观察<\/text>[\s\S]*class="add-observation"[^>]*bindtap="onOpenObservation"[^>]*>＋ 添加<\/button>/)
  assert.match(material, /wx:if="{{showObservationForm}}"[^>]*class="material-observation-form"/)
  assert.match(material, /<textarea[^>]*value="{{observationNote}}"[^>]*bindinput="onObservationInput"/)
  assert.match(material, /bindtap="onSaveObservation"[^>]*>保存<\/button>/)
  assert.match(material, /bindtap="onCancelObservation"[^>]*>取消<\/button>/)
  assert.match(material, /wx:if="{{observationError}}"[^>]*>{{observationError}}/)
  assert.match(material, /<text class="note">\{\{item\.note\}\}<\/text>/)
  assert.match(material, /class="observation-swipe[^"]*"[^>]*bindtouchstart="onObservationTouchStart"[^>]*bindtouchend="onObservationTouchEnd"/)
  assert.match(material, /class="observation-actions"[\s\S]*class="observation-edit"[^>]*catchtap="onEditObservation"[^>]*>编辑<\/view>[\s\S]*class="observation-delete"[^>]*catchtap="onDeleteObservation"[^>]*>删除<\/view>/)
  assert.match(material, /<view class="observation-delete"[^>]*catchtap="onDeleteObservation"[^>]*aria-role="button"[^>]*>删除<\/view>/)
  assert.match(material, /wx:if="{{!editingObservation \|\| editingObservation\.renderKey !== item\.renderKey}}"/)
  assert.match(material, /wx:if="{{item\.direct}}" class="note-source">\{\{item\.createdAtLabel \|\| '未记录日期'\}\}<\/text>/)
  assert.doesNotMatch(material, /“|”|记录于/)
  assert.match(material, /\{\{item\.createdAtLabel \|\| '未记录日期'\}\}/)
  assert.doesNotMatch(material, /\{\{item\.createdAt \|\| '未记录日期'\}\}/)
  const materialCss = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.wxss'), 'utf8')
  assert.match(materialCss, /\.observation-swipe\.open \.observation-swipe-content\s*\{[^}]*transform:\s*translateX\(-256rpx\)/)
  assert.match(materialCss, /\.observation-actions\s*\{[^}]*display:\s*flex[^}]*width:\s*244rpx[^}]*gap:\s*12rpx/)
  assert.match(materialCss, /\.observation-edit\s*\{[^}]*color:\s*#3f4144[^}]*background:\s*#ffffff[^}]*border:\s*1rpx solid #d8d5cf/)
  assert.match(materialCss, /\.observation-delete\s*\{[^}]*display:\s*flex[^}]*width:\s*116rpx[^}]*color:\s*#985a54[^}]*background:\s*#f6e3df[^}]*border-radius:\s*18rpx/)
  assert.match(materialCss, /\.observation-heading\s*\{[^}]*justify-content:\s*space-between[^}]*width:\s*100%/)
  assert.match(materialCss, /\.observations \.section-title\s*\{[^}]*font-weight:\s*400/)
  assert.match(materialCss, /\.material-observation-form\s*\{[^}]*padding:\s*14rpx[^}]*border-radius:\s*18rpx/)
  assert.match(materialCss, /\.material-observation-form textarea\s*\{[^}]*height:\s*96rpx[^}]*min-height:\s*96rpx[^}]*background:\s*transparent[^}]*border:\s*0/)
  assert.match(materialCss, /\.cancel-observation\.cancel-observation,\.save-observation\.save-observation\s*\{[^}]*width:\s*104rpx[^}]*height:\s*52rpx[^}]*min-height:\s*52rpx[^}]*padding:\s*0[^}]*border-radius:\s*999rpx/)
  assert.doesNotMatch(material, /还没有关于这个材料的品尝记录/)
  assert.match(materialScript, /onEditObservation\(event\)/)
  assert.match(materialScript, /orchestrateMaterialObservationUpdate/)
  assert.doesNotMatch(recipe, /材料观察|observation-form|onSaveObservation|onDeleteObservation/)
})

test('observation rows open on a deliberate left swipe and close on a right swipe', () => {
  for (const route of ['material-detail']) {
    const page = registeredDefinition(path.join(MINI, `pages/${route}/index.js`))
    const context = {
      data: { openObservationKey: '' },
      setData(value) { Object.assign(this.data, value) }
    }

    page.onObservationTouchStart.call(context, {
      currentTarget: { dataset: { key: 'observation-1' } },
      touches: [{ clientX: 240, clientY: 80 }]
    })
    page.onObservationTouchEnd.call(context, {
      currentTarget: { dataset: { key: 'observation-1' } },
      changedTouches: [{ clientX: 150, clientY: 86 }]
    })
    assert.equal(context.data.openObservationKey, 'observation-1', `${route} opens`)

    page.onObservationTouchStart.call(context, {
      currentTarget: { dataset: { key: 'observation-1' } },
      touches: [{ clientX: 150, clientY: 80 }]
    })
    page.onObservationTouchEnd.call(context, {
      currentTarget: { dataset: { key: 'observation-1' } },
      changedTouches: [{ clientX: 225, clientY: 84 }]
    })
    assert.equal(context.data.openObservationKey, '', `${route} closes`)
  }
})

test('material observation add control expands and cancels its inline form', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/material-detail/index.js'))
  const context = {
    data: { showObservationForm: false, observationNote: '待清空', observationError: '待清空', editingObservation: { direct: true } },
    setData(value) { Object.assign(this.data, value) }
  }

  page.onOpenObservation.call(context)
  assert.equal(context.data.showObservationForm, true)
  assert.equal(context.data.editingObservation, null)
  page.onCancelObservation.call(context)
  assert.deepEqual(context.data, { showObservationForm: false, observationNote: '', observationError: '', editingObservation: null, openObservationKey: '' })
})

test('editing a material observation tracks the row being hidden until save or cancel', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/material-detail/index.js'))
  const context = {
    data: { showObservationForm: false, observationNote: '', observationError: '', editingObservation: null, openObservationKey: 'material:gin:0' },
    setData(value) { Object.assign(this.data, value) }
  }

  page.onEditObservation.call(context, {
    currentTarget: {
      dataset: {
        key: 'material:gin:0',
        direct: true,
        recipeId: '',
        index: 0,
        note: '原来的观察'
      }
    }
  })

  assert.equal(context.data.showObservationForm, true)
  assert.equal(context.data.observationNote, '原来的观察')
  assert.equal(context.data.editingObservation.renderKey, 'material:gin:0')
  assert.equal(context.data.editingObservation.direct, true)
  assert.equal(context.data.editingObservation.recipeId, '')
  assert.equal(context.data.editingObservation.observationIndex, 0)
  assert.equal(context.data.openObservationKey, '')
})

test('material detail loads once on first entry and refreshes only after returning to it', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/material-detail/index.js'))
  const context = {
    materialId: '',
    reloadCount: 0,
    reload() { this.reloadCount += 1 }
  }

  page.onLoad.call(context, { id: 'gin' })
  page.onShow.call(context)
  assert.equal(context.reloadCount, 1)

  page.onShow.call(context)
  assert.equal(context.reloadCount, 2)
})

test('material detail uses compact edit and purchase date actions', () => {
  const detail = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.wxss'), 'utf8')
  assert.doesNotMatch(detail, /class="eyebrow"|>MATERIAL</)
  assert.match(detail, /class="hero-top"[\s\S]*class="title">\{\{detail\.name\}\}<\/text>[\s\S]*class="edit"[^>]*>编辑<\/button>/)
  assert.doesNotMatch(detail, /class="hero-divider"|class="settings-panel"/)
  assert.match(detail, /class="hero-top"[\s\S]*class="availability-row"[\s\S]*class="tracking-row"[\s\S]*class="tracking-details"/)
  assert.match(css, /\.hero\s*{[^}]*background:\s*#ffffff[^}]*border:\s*1rpx solid #e7e4dd/)
  assert.doesNotMatch(css, /\.settings-panel\s*\{|\.hero-divider\s*\{/)
  assert.match(css, /\.availability-row,\.tracking-row\s*\{[^}]*border-top:\s*1rpx solid rgba\(0,\s*0,\s*0,\.15\)/)
  assert.match(css, /\.edit\.edit\s*{[^}]*width:\s*auto[^}]*height:\s*64rpx[^}]*min-height:\s*64rpx[^}]*padding:\s*0 20rpx/)
  assert.match(detail, /wx:if="{{detail\.canEditTracking}}" class="tracking-details"/)
  assert.match(detail, /class="tracking-detail-row"[\s\S]*class="tracking-value-picker"[\s\S]*?class="tracking-detail-value"[\s\S]*?<\/picker>/)
  assert.doesNotMatch(detail, /class="purchase-clear"/)
  assert.doesNotMatch(detail, /class="purchase-value"|class="purchase-row"|class="purchase-actions"/)
  assert.match(css, /\.tracking-detail-row\s*{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*min-height:\s*88rpx/)
  assert.match(css, /\.tracking-value-picker\s*{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*height:\s*88rpx[^}]*min-height:\s*88rpx/)
  assert.match(css, /\.tracking-detail-value\s*{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*height:\s*88rpx/)
  assert.match(css, /\.add-observation\.add-observation\s*{[^}]*background:\s*#242321[^}]*color:\s*#ffffff/)
  assert.doesNotMatch(css, /#(?:0b5f7d|126788|176d8d)/i)
})

test('recipe detail bottom bar keeps only edit and delete inside a safe two-column layout', () => {
  const detail = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  const detailCss = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxss'), 'utf8')
  const actionBar = detail.match(/<view class="action-bar">[\s\S]*?<\/view>/)[0]
  assert.match(actionBar, /class="action-button edit"[^>]*>编辑<\/button>/)
  assert.match(actionBar, /class="action-button delete"[^>]*>删除<\/button>/)
  assert.doesNotMatch(actionBar, /复制|onCopy|action-button copy/)
  assert.equal((actionBar.match(/<button/g) || []).length, 2)
  assert.match(detailCss, /\.action-bar\s*{[^}]*box-sizing:\s*border-box[^}]*width:\s*100%[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/)
  assert.match(detailCss, /\.action-button\s*{[^}]*min-width:\s*0[^}]*height:\s*88rpx[^}]*padding:\s*0[^}]*font-weight:\s*400[^}]*line-height:\s*88rpx/)
  assert.match(detailCss, /\.hero-card\s*{[^}]*padding-top:\s*40rpx/)
  assert.match(detailCss, /\.action-button\.edit\s*{[^}]*background:\s*#3f4144/)
})

test('recipe material rows use icons and aria while missing long-term materials stay visibly distinct', () => {
  const card = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxml'), 'utf8')
  const detail = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  const cardCss = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxss'), 'utf8')
  const appCss = fs.readFileSync(path.join(MINI, 'app.wxss'), 'utf8')
  assert.doesNotMatch(card, /需购|我有|我没有|缺少/)
  assert.match(card, /quickBuyIcon/)
  assert.match(detail, /quick-buy-icon/)
  assert.match(cardCss, /missing-long-term[^}]*border-color:\s*#c9c5bd[^}]*border-style:\s*dashed/)
  assert.doesNotMatch(appCss, /missing-long-term[^}]*dashed/)
})

test('recipe save button is guarded by recipe operations', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  assert.match(editor, /class="save[^>]*disabled="{{savingRecipe}}"[^>]*loading="{{savingRecipe}}"/)
  assert.doesNotMatch(editor, /savingImage/)
  assert.match(editor, /formError/)
})
