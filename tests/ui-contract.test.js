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

function registeredDefinition(jsFile) {
  let definition = null
  const source = fs.readFileSync(jsFile, 'utf8')
  const sandbox = {
    require: createRequire(jsFile),
    Page(value) { definition = value },
    Component(value) { definition = value },
    App(value) { definition = value },
    getApp() { return null },
    wx: {},
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

test('settings locks every editor control while an asynchronous glass save is active', () => {
  const wxml = fs.readFileSync(path.join(MINI, 'pages/settings/index.wxml'), 'utf8')
  const sheet = wxml.match(/<view wx:if="{{editorOpen}}"[\s\S]*?<\/scroll-view>/)[0]
  for (const tag of sheet.match(/<(?:input|textarea|button)\b[^>]*>/g)) {
    assert.match(tag, /disabled="{{savingGlass}}"/, tag)
  }
})

test('selected filter controls expose a visible non-color marker and an accessible selected label', () => {
  const recipes = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxml'), 'utf8')
  const materials = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxml'), 'utf8')
  assert.match(recipes, /prepType === item\.key[^>]*aria-label=/)
  assert.match(recipes, /prepType === item\.key[^<]*\?\s*'✓'/)
  assert.match(recipes, /sortKey === item\.key[^>]*aria-label=/)
  assert.match(materials, /filter === item\.key[^>]*aria-label=/)
  assert.match(materials, /acquisition === item\.key[^>]*aria-label=/)
})

test('every editable form exposes validation feedback inside the form', () => {
  const expected = new Map([
    ['pages/recipe-edit/index.wxml', /errors\./],
    ['pages/material-edit/index.wxml', /errors\./],
    ['pages/settings/index.wxml', /editorError/],
    ['pages/recipe-detail/index.wxml', /observationError/],
    ['pages/materials/index.wxml', /freshError/],
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

test('recipe material rows use icons and aria without visible availability words or missing decoration', () => {
  const card = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxml'), 'utf8')
  const related = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.wxml'), 'utf8')
  const detail = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  const cardCss = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxss'), 'utf8')
  const appCss = fs.readFileSync(path.join(MINI, 'app.wxss'), 'utf8')
  assert.doesNotMatch(card, /需购|我有|我没有|缺少/)
  assert.match(card, /quickBuyIcon/)
  assert.match(related, /quickBuyIcon/)
  assert.match(detail, /quick-buy-icon/)
  assert.doesNotMatch(cardCss, /missing-long-term[^}]*border[^}]*dashed/)
  assert.doesNotMatch(appCss, /missing-long-term[^}]*dashed/)
})

test('recipe save button is guarded by both image and recipe operations', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/recipe-edit/index.wxml'), 'utf8')
  assert.match(editor, /class="save[^>]*disabled="{{savingImage \|\| savingRecipe}}"[^>]*loading="{{savingImage \|\| savingRecipe}}"/)
  assert.match(editor, /formError/)
})
