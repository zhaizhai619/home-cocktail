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
  assert.match(bar, /{{item\.displayLabel}}/)
  assert.match(bar, /bindtap="onEditGlassware"/)
  assert.match(bar, /catchtap="onRequestDeleteGlassware"/)
  assert.match(barCss, /\.glass-grid\s*{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.doesNotMatch(profile, /酒杯|固定用具|自定义用具|onAddTool|onEditTool|onRequestDeleteTool/)
})

test('recipe editor opens a dedicated two-column glassware selection page with inline add', () => {
  const app = JSON.parse(fs.readFileSync(path.join(MINI, 'app.json'), 'utf8'))
  assert.ok(app.pages.includes('pages/glass-select/index'))
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  const picker = fs.readFileSync(path.join(MINI, 'pages/glass-select/index.wxml'), 'utf8')
  const pickerCss = fs.readFileSync(path.join(MINI, 'pages/glass-select/index.wxss'), 'utf8')
  const pickerConfig = JSON.parse(fs.readFileSync(path.join(MINI, 'pages/glass-select/index.json'), 'utf8'))
  assert.equal(pickerConfig.navigationBarTitleText, '选择酒杯')
  assert.doesNotMatch(editor, /<picker[^>]*bindchange="onGlassware"/)
  assert.match(editor, /bindtap="onOpenGlasswareSelect"/)
  assert.match(picker, /暂不选择酒杯/)
  assert.match(picker, /class="glass-grid"/)
  assert.match(picker, /bindtap="onSelectGlassware"/)
  assert.match(picker, /class="page-add"[^>]*bindtap="onAddGlassware"[^>]*>＋</)
  assert.match(picker, /wx:if="{{glassEditorOpen}}"/)
  assert.match(picker, /名称（选填）/)
  assert.match(picker, /容量 ml \*/)
  assert.match(picker, /bindtap="onSaveGlassware"/)
  assert.doesNotMatch(picker, /编辑|删除|onEditGlassware|onRequestDeleteGlassware/)
  assert.match(pickerCss, /\.glass-grid\s*{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
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
  assert.match(detail, /wx:for="{{detail\.advancePreparations}}"/)
  assert.match(detail, />提前准备 ·/)
  assert.match(editorCss, /\.advance-card\s*\{[^}]*background:\s*#f8ead4/)
  assert.match(editorCss, /\.advance-name\s*\{[^}]*height:\s*52rpx[^}]*padding:\s*0 8rpx/)
  assert.match(editorCss, /\.advance-add-material\s*\{[^}]*display:\s*inline-flex[^}]*min-height:\s*40rpx[^}]*padding:\s*0 6rpx/)
  assert.match(editorCss, /\.advance-card-delete\s*\{[^}]*width:\s*52rpx[^}]*min-height:\s*32rpx/)
  assert.match(editorCss, /\.add-advance\s*\{[^}]*display:\s*inline-flex[^}]*width:\s*auto[^}]*min-height:\s*38rpx[^}]*padding:\s*0 6rpx/)
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
  assert.equal((prep.match(/<input/g) || []).length, 1)
  assert.match(prep, /class="prep-duration-text"[^>]*data-field="durationValue"[^>]*placeholder="例如 3–7"/)
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

test('home exposes exactly three all-capable dropdown filters plus one compact sort trigger', () => {
  const recipes = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxml'), 'utf8')
  assert.match(recipes, /<button[^>]*data-filter="preparation"[^>]*aria-label="制作方式/)
  assert.match(recipes, /<button[^>]*data-filter="material"[^>]*aria-label="材料条件/)
  assert.match(recipes, /<button[^>]*data-filter="rating"[^>]*aria-label="评价/)
  assert.match(recipes, /<view[^>]*class="sort-hit"[^>]*aria-role="button"[^>]*aria-label="排序/)
  assert.doesNotMatch(recipes, /class="prep-scroll"/)
  assert.doesNotMatch(recipes, /class="sort-scroll"/)
})

test('home renders three compact non-overlapping filter cards aligned with its card list', () => {
  const recipes = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxss'), 'utf8')
  assert.match(recipes, /class="filter-heading"/)
  assert.match(recipes, /class="filter-grid"/)
  assert.equal((recipes.match(/class="filter-card/g) || []).length, 3)
  assert.doesNotMatch(recipes, /class="filter-scroll"/)
  assert.match(css, /\.filter-grid\s*{[^}]*display:\s*flex[^}]*box-sizing:\s*border-box[^}]*width:\s*100%/)
  assert.match(css, /\.filter-hit\s*{[^}]*flex:\s*1 1 0[^}]*width:\s*0[^}]*min-width:\s*0[^}]*padding:\s*10rpx 8rpx 10rpx 12rpx/)
  assert.match(css, /\.sort-hit\s*{[^}]*display:\s*block[^}]*flex:\s*1[^}]*margin:\s*0[^}]*padding:\s*0[^}]*text-align:\s*right/)
  assert.match(css, /\.card-list\s*{[^}]*box-sizing:\s*border-box[^}]*width:\s*100%/)
})

test('home places a compact untried-only switch below the three filters on the right', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/recipes/index.js'))
  const recipes = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxss'), 'utf8')
  assert.equal(page.data.untriedOnly, false)
  assert.match(recipes, /class="untried-filter-row"[\s\S]*class="untried-toggle[^>]*aria-role="switch"[^>]*aria-checked="{{untriedOnly}}"/)
  assert.match(recipes, />仅看未调过</)
  assert.match(css, /\.untried-filter-row\s*{[^}]*display:\s*flex[^}]*justify-content:\s*flex-end/)
  assert.match(css, /\.untried-toggle[^}]*{[^}]*min-height:\s*88rpx[^}]*font-size:\s*22rpx/)
  assert.match(css, /\.toggle-track\s*{[^}]*border-radius:\s*999rpx/)
})

test('home untried switch toggles the filter and clear filters turns it off', () => {
  const page = registeredDefinition(path.join(MINI, 'pages/recipes/index.js'))
  const context = {
    data: { untriedOnly: false },
    refreshCount: 0,
    setData(value) { Object.assign(this.data, value) },
    refreshCards() { this.refreshCount += 1 }
  }
  page.onToggleUntried.call(context)
  assert.equal(context.data.untriedOnly, true)
  assert.equal(context.refreshCount, 1)
  page.clearFilters.call(context)
  assert.equal(context.data.untriedOnly, false)
  assert.equal(context.refreshCount, 2)
})

test('home aligns the visible add circle with the shared right content edge', () => {
  const css = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxss'), 'utf8')
  assert.match(css, /\.topbar\s*{[^}]*display:\s*flex[^}]*box-sizing:\s*border-box[^}]*width:\s*100%/)
  assert.match(css, /\.page-title\s*{[^}]*flex:\s*1/)
  assert.match(css, /\.add-hit\s*{[^}]*justify-content:\s*flex-end[^}]*flex:\s*none[^}]*width:\s*88rpx[^}]*margin:\s*0[^}]*padding:\s*0/)
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
  assert.match(prepCss, /\.chips\s*{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/)
  assert.doesNotMatch(editor, /tool-scroll|capacity-line|preview\.capacity|class="warning"/)
  assert.match(editor, /class="select"/)
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

test('recipe entry uses compact section, image and control dimensions', () => {
  const editorCss = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxss'), 'utf8')
  const ingredientCss = fs.readFileSync(path.join(MINI, 'components/ingredient-row/index.wxss'), 'utf8')
  const prepCss = fs.readFileSync(path.join(MINI, 'components/prep-editor/index.wxss'), 'utf8')
  assert.match(editorCss, /\.section\s*{[^}]*padding:\s*14rpx 12rpx/)
  assert.match(editorCss, /\.section-heading\s*{[^}]*width:\s*100%/)
  assert.match(editorCss, /\.tried-toggle\s*{[^}]*flex:\s*none[^}]*margin-left:\s*auto/)
  assert.match(editorCss, /\.basic-grid\s*{[^}]*grid-template-columns:\s*120rpx minmax\(0,\s*1fr\)/)
  assert.match(editorCss, /\.image-button\s*{[^}]*width:\s*120rpx[^}]*height:\s*128rpx/)
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
  const filterHeight = Number(homeCss.match(/\.filter-hit[^}]*min-height:\s*(\d+)rpx/)[1])
  const sortHeight = Number(homeCss.match(/\.sort-hit[^}]*min-height:\s*(\d+)rpx/)[1])
  assert.ok(filterHeight >= 88)
  assert.ok(sortHeight >= 88)
  assert.match(ingredientCss, /\.remove\.remove\s*{[^}]*width:\s*44rpx[^}]*height:\s*44rpx[^}]*min-height:\s*44rpx/)
  assert.match(prepCss, /\.chips\s*{[^}]*column-gap:\s*10rpx[^}]*row-gap:\s*8rpx/)
  assert.match(prepCss, /\.chip\.chip\s*{[^}]*flex:\s*0 0 calc\(\(100% - 20rpx\) \/ 3\)[^}]*width:\s*auto[^}]*min-height:\s*56rpx[^}]*padding:\s*0 12rpx/)
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

test('optional recipe images are persisted before their managed path enters the form', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.js'), 'utf8')
  assert.match(editor, /mediaFiles\.persistRecipeImage\(/)
  assert.match(editor, /savingImage/)
})

test('recipe detail ingredient rows navigate to their material detail', () => {
  const detail = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  assert.match(detail, /class="ingredient-row[^>]*data-id="{{item\.materialId}}"[^>]*bindtap="onOpenMaterial"/)
})

test('recipe detail missing ABV action opens the corresponding material editor', () => {
  const routes = []
  const page = registeredDefinition(path.join(MINI, 'pages/recipe-detail/index.js'), {
    navigateTo(options) { routes.push(options.url) }
  })
  const context = { data: { detail: { status: 'ok', abv: { editMaterialId: 'coconut liqueur' } } } }

  page.onEditMissingAbv.call(context)

  assert.deepEqual(routes, ['/pages/material-edit/index?id=coconut%20liqueur'])
  const wxml = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  assert.match(wxml, /wx:if="{{detail\.abv\.editMaterialId}}"[^>]*bindtap="onEditMissingAbv"/)
})

test('material observations can be recorded repeatedly from material detail while recipe entry remains available', () => {
  const material = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.wxml'), 'utf8')
  const recipe = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  assert.match(material, /<textarea[^>]*value="{{observationNote}}"[^>]*bindinput="onObservationInput"/)
  assert.match(material, /bindtap="onSaveObservation"[^>]*>保存观察<\/button>/)
  assert.match(material, /wx:if="{{observationError}}"[^>]*>{{observationError}}/)
  assert.doesNotMatch(material, /还没有关于这个材料的品尝记录/)
  assert.match(recipe, /class="observation-form"/)
  assert.match(recipe, /bindtap="onSaveObservation"/)
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

test('recipe save button is guarded by both image and recipe operations', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  assert.match(editor, /class="save[^>]*disabled="{{savingImage \|\| savingRecipe}}"[^>]*loading="{{savingImage \|\| savingRecipe}}"/)
  assert.match(editor, /formError/)
})
