const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const MINI = path.join(__dirname, '..', 'miniprogram')

function walk(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute, extension)
    return entry.isFile() && entry.name.endsWith(extension) ? [absolute] : []
  })
}

test('application shell uses a softly warm canvas and charcoal active navigation', () => {
  const app = JSON.parse(fs.readFileSync(path.join(MINI, 'app.json'), 'utf8'))

  assert.equal(app.window.backgroundColor.toLowerCase(), '#f8f5ee')
  assert.equal(app.window.navigationBarBackgroundColor.toLowerCase(), '#f8f5ee')
  assert.equal(app.tabBar.backgroundColor.toLowerCase(), '#ffffff')
  assert.equal(app.tabBar.color.toLowerCase(), '#9d9991')
  assert.equal(app.tabBar.selectedColor.toLowerCase(), '#242321')
})

test('styles retire the former warm canvas, orange brand blocks, and hero gradients', () => {
  const legacyColors = [
    '#f7f1e8',
    '#f8f2e9',
    '#f5eee5',
    '#fffaf3',
    '#fffaf2',
    '#342f2b',
    '#a96826',
    '#b86f29',
    '#e9c68e',
    '#f0dcc0'
  ]

  for (const file of walk(MINI, '.wxss')) {
    const css = fs.readFileSync(file, 'utf8').toLowerCase()
    for (const color of legacyColors) assert.doesNotMatch(css, new RegExp(color), `${path.relative(MINI, file)} still uses ${color}`)
    assert.doesNotMatch(css, /linear-gradient\(/, `${path.relative(MINI, file)} still uses a decorative gradient`)
  }
})

test('global theme exposes the shared neutral and restrained semantic palette', () => {
  const css = fs.readFileSync(path.join(MINI, 'app.wxss'), 'utf8').toLowerCase()

  for (const declaration of [
    '--color-canvas: #f8f5ee',
    '--color-surface: #fffefc',
    '--color-subtle: #f1f0ec',
    '--color-border: #e7e4dd',
    '--color-text: #242321',
    '--color-text-secondary: #6f6c66',
    '--color-text-tertiary: #9d9991',
    '--color-sage: #627969',
    '--color-sage-tint: #ebf1ed',
    '--color-blue: #6e7c8f',
    '--color-blue-tint: #ebeff3',
    '--color-amber: #957052',
    '--color-amber-tint: #f4eee8',
    '--color-danger: #985a54',
    '--color-danger-tint: #f5ebe9'
  ]) {
    assert.match(css, new RegExp(declaration), declaration)
  }
})

test('material libraries distinguish owned white cards from softer gray missing cards', () => {
  const materials = fs.readFileSync(path.join(MINI, 'pages/materials/index.wxss'), 'utf8').toLowerCase()
  const picker = fs.readFileSync(path.join(MINI, 'pages/material-select/index.wxss'), 'utf8').toLowerCase()

  assert.match(materials, /\.materials-page \.library-card\s*{[^}]*border:\s*1rpx solid #e7e4dd[^}]*box-shadow:\s*0 8rpx 24rpx rgba\(55,\s*50,\s*43,\s*\.07\)/)
  assert.match(materials, /\.library-card\.state-owned\s*{[^}]*background:\s*#fffefc[^}]*border:\s*1rpx solid #e7e4dd/)
  assert.match(materials, /\.library-card\.state-missing-long-term,\s*\.library-card\.state-quick-buy\s*{[^}]*background:\s*#f1f0ec/)
  assert.match(materials, /\.library-card\.state-missing-long-term \.library-card-name,[^}]*color:\s*#8b877f/)
  assert.match(materials, /\.materials-page \.catalog-tab\.selected\s*{[^}]*color:\s*#242321[^}]*background:\s*#e8e5df/)
  assert.doesNotMatch(materials, /\.library-card\.state-owned\s*{[^}]*border:[^;}]*#(?:20201f|242321)/)
  assert.doesNotMatch(materials, /#ebf1ed|#ebeff3/)
  assert.match(picker, /\.material-card\.state-owned\s*{[^}]*background:\s*#fffefc[^}]*border-color:\s*#e7e4dd/)
})

test('recipe list maps preparation and ingredient states to the revised visual roles', () => {
  const recipes = fs.readFileSync(path.join(MINI, 'pages/recipes/index.wxss'), 'utf8').toLowerCase()
  const card = fs.readFileSync(path.join(MINI, 'components/recipe-card/index.wxss'), 'utf8').toLowerCase()

  assert.match(recipes, /\.recipes-page\s*{[^}]*background:\s*#f8f5ee/)
  assert.match(recipes, /\.seasonal-fruit-tip\s*{[^}]*color:\s*#6f6c66/)
  assert.match(recipes, /\.filter-trigger-label::after\s*{[^}]*background:\s*#957052/)
  assert.match(recipes, /\.filter-symbol\.active \.filter-symbol-line\s*{[^}]*background:\s*#957052/)
  assert.match(recipes, /\.filter-option\.selected\s*{[^}]*color:\s*#7c6049[^}]*background:\s*#f4eee8/)
  assert.match(recipes, /\.filter-reset,\s*\.filter-collapse\s*{[^}]*color:\s*#242321[^}]*font-weight:\s*400/)
  assert.match(card, /\.prep-label\s*{[^}]*color:\s*#536274[^}]*background:\s*#ebeff3[^}]*border:\s*1rpx solid #dbe2e9/)
  assert.match(card, /\.abv-label\s*{[^}]*color:\s*#6f6c66[^}]*background:\s*transparent[^}]*border:\s*0/)
  assert.match(card, /\.ingredient\.owned\s*{[^}]*color:\s*#52665a[^}]*background:\s*#eef3ef[^}]*border-color:\s*#dce7df/)
  assert.match(card, /\.ingredient\.quick-buy,\s*\.ingredient\.missing-long-term\s*{[^}]*color:\s*#77736c[^}]*background:\s*#f8f7f4[^}]*border-color:\s*#c9c5bd[^}]*border-style:\s*dashed/)
  assert.match(card, /\.ingredient\.prepared\s*{[^}]*color:\s*#706a62[^}]*background:\s*#f6f5f2[^}]*border-color:\s*#d8d4cc/)
})

test('recipe detail uses notes wording, plain selected ratings, and a compact action bar', () => {
  const template = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(MINI, 'pages/recipe-detail/index.wxss'), 'utf8').toLowerCase()

  assert.match(template, /<text class="section-title">备注<\/text>[\s\S]*wx:for="\{\{detail\.steps\}\}"/)
  assert.match(template, /<text wx:else class="muted">暂无<\/text>/)
  assert.doesNotMatch(template, /selected-mark|>✓</)
  assert.match(css, /\.action-bar\s*{[^}]*bottom:\s*env\(safe-area-inset-bottom\)[^}]*padding:\s*12rpx 24rpx/)
  assert.match(css, /\.action-button\s*{[^}]*height:\s*88rpx[^}]*padding:\s*0[^}]*font-weight:\s*400[^}]*line-height:\s*88rpx/)
  assert.match(css, /\.hero-card\s*{[^}]*padding-top:\s*40rpx/)
  assert.match(css, /\.action-button\.edit\s*{[^}]*background:\s*#3f4144/)
  assert.match(css, /\.abv-badge\s*{[^}]*color:\s*#536274[^}]*background:\s*#ebeff3[^}]*border:\s*1rpx solid #dbe2e9/)
})

test('material editor and detail share green switches and simplified controls', () => {
  const editor = fs.readFileSync(path.join(MINI, 'pages/material-edit/index.wxml'), 'utf8')
  const editorCss = fs.readFileSync(path.join(MINI, 'pages/material-edit/index.wxss'), 'utf8').toLowerCase()
  const detail = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.wxml'), 'utf8')
  const detailCss = fs.readFileSync(path.join(MINI, 'pages/material-detail/index.wxss'), 'utf8').toLowerCase()

  assert.doesNotMatch(editor, />[^<]*\*/)
  assert.match(editor, /<text class="label">酒精度<\/text><view class="suffix-input"><input type="digit" value="\{\{form\.abv\}\}" bindinput="onAbvInput"\/>/)
  assert.doesNotMatch(editor, /placeholder="例如 20"|追踪数量与保质期|onTrackChange|默认视为常备|delete-note/)
  assert.match(editor, /<text class="switch-title">常备材料<\/text><\/view><switch checked="\{\{form\.assumedAvailable\}\}"[^>]*color="#627969"/)
  assert.match(editor, /checked="\{\{form\.alcoholic\}\}"[^>]*color="#627969"/)
  assert.match(editorCss, /\.form-actions \.save\s*{[^}]*flex:\s*1/)
  assert.match(editorCss, /\.form-actions \.delete\s*{[^}]*flex:\s*1/)

  assert.match(detail, /checked="\{\{detail\.available\}\}"[^>]*color="#627969"/)
  assert.match(detail, /checked="\{\{detail\.trackFreshness\}\}"[^>]*color="#627969"/)
  assert.match(detail, /wx:if="\{\{detail\.canEditTracking\}\}" class="tracking-details"/)
  assert.doesNotMatch(detail, /更新追踪信息|sheet-mask/)
  assert.match(detailCss, /\.tracking-detail-row\s*{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*min-height:\s*88rpx/)
  assert.match(detailCss, /\.tracking-detail-value\s*{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*height:\s*88rpx/)
})
