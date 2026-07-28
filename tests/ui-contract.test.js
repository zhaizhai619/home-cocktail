const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { createRequire } = require('node:module')

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
  assert.match(css, /\.sync-row\s*{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/)
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
  assert.match(wxml, /购买日期 \{\{item\.purchaseDateLabel\}\}/)
  assert.match(wxml, /未记录购买日期/)
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
  assert.match(css, /\.fresh-purchase-date\s*{[^}]*text-align:\s*center/)
  assert.match(css, /\.use-up\s*{[^}]*width:\s*72rpx/)
  assert.match(css, /\.fresh-recipe-row\s*{[^}]*display:\s*grid[^}]*grid-template-columns:/)
  assert.doesNotMatch(css, /\.fresh-card\s*{[^}]*width:\s*520rpx/)
})

test('expanded fresh recipe rows navigate directly to recipe detail without a sheet', () => {
  let navigation = null
  const page = registeredDefinition(path.join(MINI, 'pages/materials/index.js'), {
    navigateTo(options) { navigation = options.url }
  })
  const wxml = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxml'), 'utf8')
  page.onOpenRecipe.call({}, { currentTarget: { dataset: { id: 'r1' } } })
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
  assert.match(editor, />分类 \*</)
  assert.match(pairedFields, />获取方式 \*</)
  assert.match(pairedFields, />默认用量单位 \*</)
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
  assert.match(pickerCss, /\.page-add\s*{[^}]*height:\s*64rpx[^}]*padding:\s*0 20rpx[^}]*background:\s*#342f2b[^}]*border-radius:\s*999rpx/)
  assert.match(barCss, /\.materials-page \.pane-add\s*{[^}]*height:\s*64rpx[^}]*padding:\s*0 20rpx[^}]*background:\s*#342f2b[^}]*border-radius:\s*999rpx/)
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
  assert.match(editor, /bindtap="onRemoveAdvancePreparation"/)
  assert.match(editor, />制作方式</)
  assert.match(editorCss, /\.material-stage-switch\s*\{[^}]*display:\s*flex/)
  assert.match(editorCss, /\.material-stage-switch\s*\{[^}]*border-bottom:\s*1rpx solid #ddd6cf/)
  assert.match(editorCss, /\.material-stage\.selected::before\s*\{[^}]*height:\s*4rpx[^}]*background:\s*#24211f/)
  assert.doesNotMatch(editorCss, /\.material-stage\.selected\s*\{[^}]*background:\s*#(?:6c594a|24211f)/)
  assert.match(detail, /wx:for="{{detail\.ingredients}}"/)
  assert.match(detail, /wx:if="{{item\.preparation}}"[^>]*class="advance-inline"/)
  assert.doesNotMatch(detail, /wx:for="{{detail\.advancePreparations}}"|>提前准备 ·/)
  assert.match(editorCss, /\.advance-card\s*\{[^}]*background:\s*#f8ead4/)
  assert.match(editorCss, /\.advance-name\s*\{[^}]*height:\s*52rpx[^}]*padding:\s*0 8rpx/)
  assert.match(editorCss, /\.advance-add-material\s*\{[^}]*display:\s*inline-flex[^}]*min-height:\s*40rpx[^}]*padding:\s*0 6rpx/)
  assert.match(editorCss, /\.advance-card-delete\s*\{[^}]*width:\s*52rpx[^}]*min-height:\s*32rpx/)
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

  assert.match(template, /wx:for="{{item\.preparation\.ingredients}}"/)
  assert.match(template, /wx:if="{{item\.preparation\.hasSteps}}"[^>]*class="advance-steps-toggle"[^>]*bindtap="onTogglePreparationSteps"/)
  assert.match(template, /\{\{expandedPreparationIds\[item\.preparation\.id\] \? '▼' : '▶'\}\} 制作步骤/)
  assert.match(template, /wx:if="{{expandedPreparationIds\[item\.preparation\.id\]}}"[^>]*class="advance-steps"/)
  assert.match(css, /\.advance-inline\s*{[^}]*background:\s*#f7f3ed[^}]*border:\s*1rpx solid #e9dfd3/)
  assert.doesNotMatch(css, /\.advance-inline\s*{[^}]*background:\s*#f8e4d7/)
  assert.match(css, /\.advance-steps-toggle\s*{[^}]*font-size:\s*23rpx/)
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
  assert.equal((editor.match(/bindtap="onOpenMaterialSelect"/g) || []).length, 6)
  assert.match(editor, /class="[^"]*advance-add-material[^"]*"[^>]*data-stage="advance"/)
  assert.doesNotMatch(editor, /basePickerOpen|苏打\/汤力|>＋果汁<|>＋奶制品</)
  assert.match(picker, /placeholder="搜索材料"/)
  assert.match(picker, /class="category-tabs"[^>]*scroll-x="true"/)
  assert.match(picker, /class="material-grid"/)
  assert.match(picker, /wx:if="{{canCreateMaterial && !creatingMaterial}}"[^>]*class="create-material"/)
  assert.match(picker, /添加「{{newMaterialName}}」/)
  assert.match(picker, /wx:if="{{creatingMaterial}}"[^>]*class="create-category-panel"/)
  assert.match(picker, /wx:for="{{creationCategories}}"[^>]*bindtap="onSelectCreateCategory"/)
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

  context.data.query = '金酒'
  page.reload.call(context)
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
  assert.match(editor, /<switch[^>]*checked="{{form\.trackFreshness}}"[^>]*bindchange="onTrackChange"/)
  assert.match(detail, /class="availability-row"/)
  assert.match(detail, /<switch[^>]*checked="{{detail\.available}}"[^>]*bindchange="onToggleAvailable"/)
  assert.match(detail, /wx:if="{{detail\.canToggleTracking}}"[^>]*class="tracking-row"/)
  assert.match(detail, /<switch[^>]*checked="{{detail\.trackFreshness}}"[^>]*bindchange="onToggleTracking"/)
  assert.match(detail, /wx:if="{{detail\.canEditTracking}}"[^>]*bindtap="onOpenTrackingForm"[^>]*>更新追踪信息</)
  assert.doesNotMatch(detail, />加入手头鲜材</)
  const actions = editor.match(/<view class="form-actions">[\s\S]*?<\/view>/)[0]
  assert.match(actions, /class="save"[^>]*>保存材料<\/button>/)
  assert.match(actions, /class="delete"[^>]*>删除材料<\/button>/)
  assert.match(editorCss, /\.form-actions\s*{[^}]*display:\s*flex[^}]*align-items:\s*stretch/)
  assert.match(editorCss, /\.form-actions \.save\s*{[^}]*flex:\s*2/)
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
  assert.match(css, /\.filter-symbol\.active \.filter-symbol-line\s*{[^}]*background:\s*#b86f29/)
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
  assert.match(css, /\.add-hit\s*{[^}]*flex:\s*none[^}]*width:\s*auto[^}]*height:\s*64rpx[^}]*min-height:\s*64rpx[^}]*margin:\s*0[^}]*padding:\s*0 20rpx[^}]*color:\s*#fff[^}]*background:\s*#342f2b[^}]*border-radius:\s*999rpx[^}]*font-size:\s*21rpx[^}]*line-height:\s*64rpx/)
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
  assert.match(css, /\.rating-option\s*{[^}]*color:\s*#766c63[^}]*background:\s*#eee8df/)
  assert.doesNotMatch(css, /\.detail-page \.ratings \.rating-option/)
})

test('recipe detail shows combined notes only in the steps section', () => {
  const template = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxss'), 'utf8')
  assert.doesNotMatch(template, /detail\.tastingNote|暂未记录总体备注/)
  assert.doesNotMatch(css, /\.tasting-note/)
  assert.match(template, /<text class="section-title">制作步骤<\/text>[\s\S]*wx:for="\{\{detail\.steps\}\}"/)
})

test('recipe cards distinguish prepared outputs with a warm ingredient label', () => {
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
  assert.match(css, /\.untried-label\s*{[^}]*color:\s*#655f59[^}]*background:/)
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
  assert.match(editor, /<view[^>]*class="material-shortcuts">/)
  assert.doesNotMatch(editor, /class="material-shortcuts"[^>]*scroll-x=/)
  assert.match(css, /\.shortcut-track\s*{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/)
})

test('recipe entry exposes only the five approved material-library shortcuts', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-edit/index.js'))
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  assert.deepEqual(Array.from(page.data.addCategories, (item) => item.label), ['基酒', '利口酒', '果汁/果蔬', '混合饮品', '材料库'])
  assert.equal((editor.match(/<button[^>]*size="mini"[^>]*class="shortcut(?: primary)?"/g) || []).length, 5)
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
    ['pages/recipe-detail/index.wxml', /observationError/],
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
  assert.match(css, /\.abv-badge\s*{[^}]*min-height:\s*48rpx[^}]*padding:\s*0 18rpx[^}]*border:\s*0/)
  assert.match(wxml, /bindinput="onManualAbvInput"/)
  assert.match(wxml, /bindtap="onSaveManualAbv"/)
  assert.match(wxml, /bindtap="onClearManualAbv"/)
  assert.doesNotMatch(wxml, /预估酒精度|预计总体积|总体积信息不完整|detail\.capacity|calculation-notice|onEditMissingAbv/)
})

test('material observations can be recorded repeatedly from material detail while recipe entry remains available', () => {
  const material = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.wxml'), 'utf8')
  const materialScript = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.js'), 'utf8')
  const recipe = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  assert.match(material, /class="observation-heading"[\s\S]*class="section-title">我的材料观察<\/text>[\s\S]*class="add-observation"[^>]*bindtap="onOpenObservation"[^>]*>＋ 添加<\/button>/)
  assert.match(material, /wx:if="{{showObservationForm}}"[^>]*class="material-observation-form"/)
  assert.match(material, /<textarea[^>]*value="{{observationNote}}"[^>]*bindinput="onObservationInput"/)
  assert.match(material, /bindtap="onSaveObservation"[^>]*>保存观察<\/button>/)
  assert.match(material, /bindtap="onCancelObservation"[^>]*>取消<\/button>/)
  assert.match(material, /wx:if="{{observationError}}"[^>]*>{{observationError}}/)
  assert.match(material, /\{\{item\.createdAtLabel \|\| '未记录日期'\}\}/)
  assert.doesNotMatch(material, /\{\{item\.createdAt \|\| '未记录日期'\}\}/)
  assert.doesNotMatch(material, /还没有关于这个材料的品尝记录/)
  assert.match(materialScript, /this\.setData\(\{\s*observationNote:\s*'',\s*observationError:\s*'',\s*showObservationForm:\s*false\s*\}\)/)
  assert.match(recipe, /class="observation-form"/)
  assert.match(recipe, /bindtap="onSaveObservation"/)
})

test('material observation add control expands and cancels its inline form', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/material-detail/index.js'))
  const context = {
    data: { showObservationForm: false, observationNote: '待清空', observationError: '待清空' },
    setData(value) { Object.assign(this.data, value) }
  }

  page.onOpenObservation.call(context)
  assert.equal(context.data.showObservationForm, true)
  page.onCancelObservation.call(context)
  assert.deepEqual(context.data, { showObservationForm: false, observationNote: '', observationError: '' })
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
  assert.match(detail, /class="hero-divider"/)
  assert.match(detail, /class="settings-panel"[\s\S]*class="availability-row"[\s\S]*class="tracking-row"/)
  assert.match(detail, /class="settings-panel"[\s\S]*<\/view>\s*<view wx:if="\{\{detail\.canEditPurchasedAt\}\}" class="purchase-row"/)
  assert.match(css, /\.hero\s*{[^}]*background:\s*linear-gradient\(145deg,#fffaf0,#f0dcc0\)[^}]*border:\s*1rpx solid #e5c99f/)
  assert.match(css, /\.settings-panel\s*{[^}]*background:\s*#f6ead9/)
  assert.match(css, /\.edit\.edit\s*{[^}]*width:\s*auto[^}]*height:\s*64rpx[^}]*min-height:\s*64rpx[^}]*padding:\s*0 20rpx/)
  assert.match(detail, /class="purchase-actions"><picker[\s\S]*?class="purchase-value"[\s\S]*?<\/picker><button[^>]*class="purchase-clear"[^>]*>清除<\/button><\/view>/)
  assert.doesNotMatch(detail, /class="purchase-value"[^>]*>[^<]*›/)
  assert.match(css, /\.purchase-clear\.purchase-clear\s*{[^}]*height:\s*40rpx[^}]*min-height:\s*40rpx[^}]*border:\s*1rpx solid[^}]*border-radius:\s*10rpx/)
  assert.match(css, /\.add-observation\.add-observation\s*{[^}]*background:\s*#342f2b[^}]*color:\s*#fff/)
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
  assert.match(detailCss, /\.action-button\s*{[^}]*min-width:\s*0/)
})

test('recipe material rows use icons and aria without visible availability words or missing decoration', () => {
  const card = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxml'), 'utf8')
  const detail = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  const cardCss = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxss'), 'utf8')
  const appCss = fs.readFileSync(path.join(MINI, 'app.wxss'), 'utf8')
  assert.doesNotMatch(card, /需购|我有|我没有|缺少/)
  assert.match(card, /quickBuyIcon/)
  assert.match(detail, /quick-buy-icon/)
  assert.doesNotMatch(cardCss, /missing-long-term[^}]*border[^}]*dashed/)
  assert.doesNotMatch(appCss, /missing-long-term[^}]*dashed/)
})

test('recipe save button is guarded by recipe operations', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  assert.match(editor, /class="save[^>]*disabled="{{savingRecipe}}"[^>]*loading="{{savingRecipe}}"/)
  assert.doesNotMatch(editor, /savingImage/)
  assert.match(editor, /formError/)
})
