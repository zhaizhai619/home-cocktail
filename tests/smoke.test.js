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
