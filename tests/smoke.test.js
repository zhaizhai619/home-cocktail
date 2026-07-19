const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('app config starts with recipes and declares the three tabs', () => {
  const appConfigPath = path.join(__dirname, '..', 'miniprogram', 'app.json')
  const appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'))

  assert.equal(appConfig.pages[0], 'pages/recipes/index')
  assert.deepEqual(
    appConfig.tabBar.list.map((tab) => tab.text),
    ['酒单', '材料', '我的']
  )
})

test('declared pages and recipe card component have complete mini-program files', () => {
  const root = path.join(__dirname, '..', 'miniprogram')
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))

  for (const page of appConfig.pages) {
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert.ok(fs.existsSync(path.join(root, `${page}.${extension}`)), `${page}.${extension}`)
    }
  }

  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    assert.ok(fs.existsSync(path.join(root, 'components', 'recipe-card', `index.${extension}`)))
  }

  const recipePage = fs.readFileSync(path.join(root, 'pages', 'recipes', 'index.json'), 'utf8')
  assert.match(recipePage, /"recipe-card"\s*:\s*"\/components\/recipe-card\/index"/)
})

test('fast recipe editor route and focused form components are registered', () => {
  const root = path.join(__dirname, '..', 'miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.ok(config.pages.includes('pages/recipe-edit/index'))
  for (const component of ['ingredient-row', 'prep-editor']) {
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert.ok(fs.existsSync(path.join(root, 'components', component, `index.${extension}`)))
    }
  }
  const editorConfig = fs.readFileSync(path.join(root, 'pages', 'recipe-edit', 'index.json'), 'utf8')
  assert.match(editorConfig, /"ingredient-row"/)
  assert.match(editorConfig, /"prep-editor"/)
  const ingredientRow = fs.readFileSync(path.join(root, 'components', 'ingredient-row', 'index.wxml'), 'utf8')
  assert.match(ingredientRow, /data-field="name"/)
  assert.match(fs.readFileSync(path.join(root, 'components', 'ingredient-row', 'index.js'), 'utf8'), /this\.data\.units\[index\]\.value/)
  assert.match(fs.readFileSync(path.join(root, 'components', 'prep-editor', 'index.js'), 'utf8'), /preparation\.units\[pickerIndex\]\.value/)
  assert.match(ingredientRow, /category/)
  assert.match(ingredientRow, /switch/)
  assert.match(ingredientRow, /item\.isExisting/)
})
