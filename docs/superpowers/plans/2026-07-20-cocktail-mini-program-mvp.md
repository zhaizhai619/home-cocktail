# 家庭调酒微信小程序 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可直接导入微信开发者工具的原生小程序 MVP，打通个人酒单录入、准备与材料筛选、手头鲜材管理、材料关联酒款、杯具/用具以及预估酒精度的完整闭环。

**Architecture:** 使用原生 WXML/WXSS/JavaScript 页面；计算、筛选、材料默认值等纯业务规则放在 `miniprogram/domain/`，通过 CommonJS 同时供微信运行时和 Node 测试使用。页面只通过 `miniprogram/services/repository.js` 读写数据；MVP 使用 `wx` 本地存储，未来可以替换为云端仓库而不改页面业务逻辑。

**Tech Stack:** 微信原生小程序、JavaScript、WXML、WXSS、微信本地存储 API、Node.js 24 内置测试运行器（`node --test`），不引入运行时第三方依赖。

---

## 文件结构

```text
project.config.json                 微信开发者工具项目配置
package.json                        Node 测试与校验命令
README.md                           导入、运行与数据说明
scripts/check-js.js                 递归执行 JS 语法检查
miniprogram/
  app.js                            应用启动与存储初始化
  app.json                          页面与底部导航配置
  app.wxss                          全局设计令牌和基础样式
  sitemap.json                      小程序索引配置
  assets/icons/                     本地导航图标
  domain/constants.js              固定标签、评价、基酒、用具、单位
  domain/material.js               材料默认值、状态和视觉语义
  domain/abv.js                    总体积与预估酒精度
  domain/recipe.js                 准备主标签、排序、材料条件筛选
  domain/relations.js              材料使用数、解锁数、关联酒款
  services/repository.js           数据仓库接口和 wx 本地存储实现
  services/schema.js               初始数据与 schema 版本迁移
  components/recipe-card/          酒款卡片
  components/ingredient-row/       配方材料编辑行
  components/prep-editor/          多准备方式编辑器
  pages/recipes/index.*            酒单首页
  pages/recipe-edit/index.*        新增/编辑酒款
  pages/recipe-detail/index.*      酒款详情
  pages/materials/index.*          手头鲜材与完整材料库
  pages/material-detail/index.*    材料详情与关联酒款
  pages/settings/index.*           杯具、用具与数据设置
tests/                              Node 业务规则测试
```

## 核心数据形状

```js
// Recipe
{
  id, name, imagePath, source, tried, createdAt, updatedAt,
  ingredients: [{ materialId, amount, unit }],
  preparations: [{ type, amount, unit, note }],
  glasswareId, toolIds, steps,
  rating, tastingNote,
  materialObservations: [{ materialId, note, createdAt }]
}

// Material
{
  id, name, category, acquisition, form, defaultUnit,
  alcoholic, abv, owned, freshOnHand,
  trackFreshness, assumedAvailable,
  remainingAmount, remainingUnit, purchasedAt, expiresAt,
  preferenceNote, createdAt, updatedAt
}

// Glassware / Tool
{ id, name, capacity, imagePath, note, builtIn }
```

`assumedAvailable` 仅用于默认不追踪的柠檬/青柠、糖和常备糖浆；开启余量追踪后自动变为 `false`，改按实际库存状态判断。

### Task 1: 创建可导入、可测试的小程序骨架

**Files:**
- Create: `package.json`
- Create: `project.config.json`
- Create: `miniprogram/app.js`
- Create: `miniprogram/app.json`
- Create: `miniprogram/app.wxss`
- Create: `miniprogram/sitemap.json`
- Create: `miniprogram/pages/recipes/{index.js,index.json,index.wxml,index.wxss}`
- Create: `miniprogram/pages/materials/{index.js,index.json,index.wxml,index.wxss}`
- Create: `miniprogram/pages/settings/{index.js,index.json,index.wxml,index.wxss}`
- Create: `scripts/check-js.js`
- Create: `tests/smoke.test.js`

- [ ] **Step 1: 写骨架失败测试**

```js
// tests/smoke.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('mini program declares recipes as first page and three tabs', () => {
  const app = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
  assert.equal(app.pages[0], 'pages/recipes/index');
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['酒单', '材料', '我的']);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test`  
Expected: FAIL，提示 `package.json` 或 `miniprogram/app.json` 不存在。

- [ ] **Step 3: 创建最小项目配置**

`package.json` 使用：

```json
{
  "name": "home-cocktail-mini-program",
  "private": true,
  "scripts": {
    "test": "node --test tests/*.test.js",
    "check:js": "node scripts/check-js.js",
    "check": "npm run check:js && npm test"
  }
}
```

`scripts/check-js.js` 使用 `fs.readdirSync(..., { withFileTypes: true })` 递归收集 `miniprogram/` 下所有 `.js` 文件，并逐个调用 `spawnSync(process.execPath, ['--check', file])`；任一文件失败即以非零状态退出，避免依赖 shell 的 `**` glob 行为。

`app.json` 首页面为酒单，底部导航为酒单、材料、我的；使用 `style: "v2"`，全局背景为浅暖白。Task 1 同时创建三个 Tab 页的最小可渲染占位文件，保证开发者工具从第一次提交起即可导入；后续任务原地替换页面内容。`project.config.json` 将 `miniprogramRoot` 指向 `miniprogram/`，使用 `touristappid` 方便本地导入。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test`  
Expected: 1 test PASS。

- [ ] **Step 5: 提交骨架**

```bash
git add package.json project.config.json scripts/check-js.js miniprogram tests/smoke.test.js
git commit -m "chore: scaffold native cocktail mini program"
```

### Task 2: 定义稳定的数据常量和材料默认值

**Files:**
- Create: `miniprogram/domain/constants.js`
- Create: `miniprogram/domain/material.js`
- Create: `tests/material.test.js`

- [ ] **Step 1: 写材料默认值失败测试**

覆盖以下断言：

```js
assert.deepEqual(QUICK_BASE_SPIRITS.map((item) => item.name),
  ['金酒', '白朗姆', '威士忌', '伏特加', '龙舌兰']);
assert.deepEqual(createMaterialDefaults('base-spirit', '金酒'), {
  acquisition: 'long-term', form: 'liquid', unit: 'ml',
  alcoholic: true, abv: 40, owned: true, trackFreshness: false
});
assert.equal(createMaterialDefaults('fruit', '西瓜').freshOnHand, false);
assert.equal(createMaterialDefaults('tonic', '汤力水').unit, 'top-up');
```

- [ ] **Step 2: 确认测试失败**

Run: `node --test tests/material.test.js`  
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现常量和默认值**

定义：

- `PREP_TYPES`：即调、冷冻、冷泡/浸泡、奶洗、低温慢煮、其他预制；
- `RATINGS`：夯、顶尖、人上人、NPC、拉完了；
- `QUICK_BASE_SPIRITS`：五种快捷基酒，默认 40%；
- `QUICK_TOOLS`：PRD 第 5.8 节列出的十一种用具；
- `UNITS`：ml、g、个、片、滴、块、补满、适量；
- `createMaterialDefaults(category, name)`：按 PRD 第 5.6.1 节返回默认字段；
- `getMaterialVisualState(material)`：返回 `owned`、`quick-buy` 或 `missing-long-term`。

- [ ] **Step 4: 运行测试**

Run: `node --test tests/material.test.js`  
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add miniprogram/domain/constants.js miniprogram/domain/material.js tests/material.test.js
git commit -m "feat: define cocktail material defaults"
```

### Task 3: 用 TDD 实现预估酒精度

**Files:**
- Create: `miniprogram/domain/abv.js`
- Create: `tests/abv.test.js`

- [ ] **Step 1: 写核心计算失败测试**

至少覆盖：

```js
assert.deepEqual(calculateAbv([
  { name: '金酒', amount: 40, unit: 'ml', alcoholic: true, abv: 40 },
  { name: '柠檬汁', amount: 20, unit: 'ml', alcoholic: false },
  { name: '糖浆', amount: 20, unit: 'ml', alcoholic: false }
]), { status: 'ok', abv: 20, liquidVolume: 80, missing: [], ignored: [] });

assert.equal(calculateAbv([
  { name: '金酒', amount: 40, unit: 'ml', alcoholic: true, abv: 40 },
  { name: '汤力水', unit: 'top-up', alcoholic: false }
]).liquidVolume, 140);

assert.deepEqual(calculateAbv([
  { name: '紫罗兰利口酒', amount: 10, unit: 'ml', alcoholic: true }
]).missing, ['紫罗兰利口酒']);
```

- [ ] **Step 2: 确认失败**

Run: `node --test tests/abv.test.js`  
Expected: FAIL，`calculateAbv` 不存在。

- [ ] **Step 3: 实现计算规则**

返回结构：

```js
{ status: 'ok' | 'missing', abv, liquidVolume, missing, ignored }
```

规则完全遵循 PRD 5.10：所有 ml 计入分母，补满按 100ml，水果 ml 计入，固体/滴/适量的非酒精材料忽略，含酒精非 ml 或缺 ABV 时返回缺失，不展示部分结果。

- [ ] **Step 4: 运行测试**

Run: `node --test tests/abv.test.js`  
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add miniprogram/domain/abv.js tests/abv.test.js
git commit -m "feat: calculate estimated cocktail abv"
```

### Task 4: 实现准备方式、材料条件筛选和排序

**Files:**
- Create: `miniprogram/domain/recipe.js`
- Create: `tests/recipe.test.js`

- [ ] **Step 1: 写失败测试**

测试：

- `即调` 与其他准备方式互斥；
- 多准备方式以最长时长作为卡片主标签和排序值；
- 标签筛选命中任意准备方式；
- `on-hand` 只保留全部材料当前已有的酒；
- `fresh-only` 只保留不缺长期材料、但至少缺一种可临采材料的酒；
- `assumedAvailable: true` 且未开启追踪的柠檬/青柠、糖和常备糖浆始终视为可用；开启追踪后按实际 `owned`/`freshOnHand` 判断；
- 同时组合“即调＋补鲜材”；
- 评价排序按五档，未评价最后。
- 准备时长相同时按 `createdAt` 从新到旧排序。

- [ ] **Step 2: 确认失败**

Run: `node --test tests/recipe.test.js`  
Expected: FAIL，recipe domain 不存在。

- [ ] **Step 3: 实现纯函数**

导出：

```js
normalizePrepSelections(preparations)
getPrimaryPreparation(preparations)
getMaterialReadiness(recipe, materialsById)
filterRecipes(recipes, options, materialsById)
sortRecipes(recipes, sortKey)
```

- [ ] **Step 4: 运行测试**

Run: `node --test tests/recipe.test.js`  
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add miniprogram/domain/recipe.js tests/recipe.test.js
git commit -m "feat: filter and sort personal cocktail list"
```

### Task 5: 实现材料关系、使用数与解锁数

**Files:**
- Create: `miniprogram/domain/relations.js`
- Create: `tests/relations.test.js`

- [ ] **Step 1: 写失败测试**

构造三款酒，验证：

- `getRecipesUsingMaterial('violet')` 返回所有包含紫罗兰利口酒的酒；
- 使用数统计全部关联酒；
- 解锁数只统计购买这一项长期材料后不再缺长期材料的酒；
- 随买随用材料不作为长期解锁阻碍；
- 关联结果包含杯具和用具 ID，供页面展示。
- `getMaterialPreferenceNotes(materialId, recipes)` 汇总各酒款品尝记录中针对该材料的观察，并保留酒名、备注和时间。

- [ ] **Step 2: 确认失败**

Run: `node --test tests/relations.test.js`  
Expected: FAIL。

- [ ] **Step 3: 实现关系函数**

导出 `getRecipesUsingMaterial`、`getMaterialUsageStats`、`hydrateRecipeSummary`、`getMaterialPreferenceNotes`，保持函数无存储依赖。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/relations.test.js`  
Expected: 全部 PASS。

```bash
git add miniprogram/domain/relations.js tests/relations.test.js
git commit -m "feat: derive material recipe relationships"
```

### Task 6: 实现版本化本地数据仓库

**Files:**
- Create: `miniprogram/services/schema.js`
- Create: `miniprogram/services/repository.js`
- Create: `tests/repository.test.js`
- Modify: `miniprogram/app.js`

- [ ] **Step 1: 写内存适配器失败测试**

验证空存储初始化为：

```js
{ version: 1, recipes: [], materials: [], glassware: [], tools: QUICK_TOOLS }
```

并验证新增、更新、删除酒款，材料 upsert，鲜材加入/用完，长期材料有无切换，材料分类与追踪设置覆盖，杯具和自定义用具持久化。Recipe 与 Material 必须保持“核心数据形状”所列字段；旧版本缺字段时由 schema migration 补默认值。

- [ ] **Step 2: 确认失败**

Run: `node --test tests/repository.test.js`  
Expected: FAIL。

- [ ] **Step 3: 实现仓库**

`createRepository(adapter)` 接收 `{ get, set }`；测试使用内存 adapter，小程序使用包装 `wx.getStorageSync`/`wx.setStorageSync` 的 adapter。所有页面只调用仓库方法，不直接访问 `wx` 存储。

- [ ] **Step 4: 运行全部测试**

Run: `npm test`  
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add miniprogram/services miniprogram/app.js tests/repository.test.js
git commit -m "feat: persist cocktail data locally"
```

### Task 7: 建立视觉系统和酒单首页

**Files:**
- Create: `miniprogram/assets/icons/*.png`
- Create: `miniprogram/components/recipe-card/{index.js,index.json,index.wxml,index.wxss}`
- Modify: `miniprogram/pages/recipes/{index.js,index.json,index.wxml,index.wxss}`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/app.wxss`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: 扩展配置失败测试**

验证当前 `app.json` 声明的每个页面都存在 `.js/.json/.wxml/.wxss` 四个文件，recipe-card 文件齐全，三个导航图标及选中态图标存在。ingredient-row 和 prep-editor 的断言在 Task 8 创建组件后再加入。

- [ ] **Step 2: 确认失败后实现设计令牌**

Run: `npm test`  
Expected: FAIL，页面文件不存在。

在 `app.wxss` 定义暖白背景、深墨正文、琥珀色可临采、灰色长期缺少、准备标签颜色、圆角、间距和按钮。避免渐变和高饱和大色块。

- [ ] **Step 3: 实现 recipe-card**

卡片展示酒名、可选图片、最长准备标签、材料简表和文字评价。材料按 `owned`、`quick-buy`、`missing-long-term` 三种 class 渲染；可临采显示小购物袋符号，长期缺少只置灰，不添加状态标签。

- [ ] **Step 4: 实现酒单页**

实现搜索、横向准备标签、`材料：全部 ▾` 底部选择器、排序菜单、组合筛选、空状态和新增按钮。页面 `onShow` 时从仓库刷新。

- [ ] **Step 5: 校验与提交**

Run: `npm run check`  
Expected: 语法检查与全部测试 PASS。

```bash
git add miniprogram/app.json miniprogram/app.wxss miniprogram/assets miniprogram/components miniprogram/pages/recipes tests/smoke.test.js
git commit -m "feat: build personal cocktail list screen"
```

### Task 8: 实现快捷配方录入

**Files:**
- Create: `miniprogram/components/ingredient-row/{index.js,index.json,index.wxml,index.wxss}`
- Create: `miniprogram/components/prep-editor/{index.js,index.json,index.wxml,index.wxss}`
- Create: `miniprogram/pages/recipe-edit/{index.js,index.json,index.wxml,index.wxss}`
- Modify: `miniprogram/app.json`
- Create: `tests/recipe-form.test.js`

- [ ] **Step 1: 写表单转换失败测试**

将表单转换函数放在 `recipe-edit/model.js` 或纯 domain 模块，测试默认包含可删除的柠檬汁和糖浆、柠檬汁可替换青柠汁、糖浆可替换具体糖浆、液体默认 ml、水果默认 ml、汤力水默认补满、快捷基酒默认 40%。

- [ ] **Step 2: 确认失败并实现表单模型**

Run: `node --test tests/recipe-form.test.js`  
Expected: 先 FAIL，完成模型后 PASS。

- [ ] **Step 3: 实现单页快速录入 UI**

页面分区严格按 PRD 5.2：基本信息、材料、准备方式、杯具与计算、制作和评价。底部固定保存按钮。材料行支持搜索已有材料、新建材料、替换名称、切换单位和删除。

评价区除固定五档和总体备注外，允许用户从本酒配方材料中选择一项并填写材料观察；保存为 `materialObservations`，同一材料可有多条不同时间记录。

- [ ] **Step 4: 实现多准备方式校验和实时 ABV**

即调与其他方式互斥；每个非即调方式独立时长；缺 ABV 时在结果区列出材料并可定位补填；正常时显示 `预估酒精度 XX%`。

- [ ] **Step 5: 保存并回到酒单**

保存时 upsert 材料，保存 recipe，使用 `redirectTo`/`navigateBack` 返回；编辑模式回填原数据。

- [ ] **Step 6: 校验与提交**

Run: `npm run check`  
Expected: 全部 PASS。

```bash
git add miniprogram/components/ingredient-row miniprogram/components/prep-editor miniprogram/pages/recipe-edit miniprogram/app.json tests/recipe-form.test.js
git commit -m "feat: add fast cocktail recipe editor"
```

### Task 9: 实现酒款详情和评价

**Files:**
- Create: `miniprogram/pages/recipe-detail/{index.js,index.json,index.wxml,index.wxss}`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/recipes/index.js`

- [ ] **Step 1: 注册详情页并连通卡片跳转**

点击酒款卡片携带 recipe ID；详情页读取并处理不存在 ID 的错误状态。

- [ ] **Step 2: 实现详情内容**

展示可选图片、全部准备方式、杯具、预计总体积、预估酒精度、三态材料、用具、步骤、准备说明、固定五档评价、总体备注和本次材料观察。详情页允许继续追加一条材料观察并保存时间。

- [ ] **Step 3: 实现编辑、复制和删除**

编辑进入已有表单；复制生成新 ID 并在名称末尾加“副本”；删除二次确认，但不删除材料库材料。

- [ ] **Step 4: 校验与提交**

Run: `npm run check`  
Expected: 全部 PASS。

```bash
git add miniprogram/pages/recipe-detail miniprogram/pages/recipes miniprogram/app.json
git commit -m "feat: add cocktail details and tasting labels"
```

### Task 10: 实现手头鲜材和材料库

**Files:**
- Modify: `miniprogram/pages/materials/{index.js,index.json,index.wxml,index.wxss}`
- Create: `miniprogram/pages/material-detail/{index.js,index.json,index.wxml,index.wxss}`
- Create: `miniprogram/pages/material-edit/{index.js,index.json,index.wxml,index.wxss}`
- Modify: `miniprogram/app.json`
- Create: `tests/material-library.test.js`

- [ ] **Step 1: 写完整材料库失败测试**

测试以下仓库行为：

- 独立创建和编辑材料；
- 新建时覆盖获取方式、形态、默认单位、酒精状态、ABV、追踪设置和初始状态；
- 长期材料切换“我有/我没有”并同步影响筛选；
- 加入手头鲜材、修改剩余量/单位/过期日、用完移除；
- “用完”不会删除材料实体或关联酒款；
- 被任一酒款引用的材料禁止删除并返回关联数；
- 未被引用的材料可以真正删除。

- [ ] **Step 2: 确认失败并补足仓库方法**

Run: `node --test tests/material-library.test.js`  
Expected: 先 FAIL，补足后 PASS。

- [ ] **Step 3: 实现材料页**

顶部独立“手头鲜材”区域，卡片展示剩余量、过期日期、看能做什么、用完；下方完整材料库支持搜索和全部/长期/随买随用/我没有筛选。页面提供独立“新增材料”入口，进入 `pages/material-edit/index`；材料卡片的编辑操作携带 ID 进入同一页面。编辑页可以覆盖系统默认分类、获取方式、形态、单位、酒精属性、ABV、追踪设置和当前状态。

- [ ] **Step 4: 实现高频加入和用完**

长期材料在列表和详情中直接切换“我有/我没有”。随买随用材料可从最近材料、搜索结果和材料详情一键加入；“用完”立即移出并提供 toast/底部提示中的撤销操作，不弹确认框。

- [ ] **Step 5: 实现材料详情和关联酒款**

展示使用数、立即解锁数、从各酒款 `materialObservations` 聚合的偏好记录、关联酒款。关联卡片展示完整材料简表、杯具和用具；点击进入酒款详情。

- [ ] **Step 6: 实现真正删除的保护交互**

“用完”保持一键撤销；“删除材料”只放在 `pages/material-edit/index` 编辑模式底部。被酒款引用时阻止删除并列出关联数；未被引用时使用确认弹窗后删除。

- [ ] **Step 7: 校验与提交**

Run: `npm run check`  
Expected: 全部 PASS。

```bash
git add miniprogram/pages/materials miniprogram/pages/material-detail miniprogram/pages/material-edit miniprogram/app.json miniprogram/services tests/material-library.test.js
git commit -m "feat: manage fresh materials and related cocktails"
```

### Task 11: 实现杯具、用具和数据设置

**Files:**
- Modify: `miniprogram/pages/settings/{index.js,index.json,index.wxml,index.wxss}`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/recipe-edit/index.js`
- Modify: `miniprogram/pages/recipe-detail/index.js`
- Create: `tests/settings.test.js`

- [ ] **Step 1: 写仓库行为测试**

覆盖杯具新增/编辑/删除、自定义用具新增/删除，以及被酒款引用时删除的保护策略。

- [ ] **Step 2: 实现设置页**

杯具字段为名称、容量、选填图片和备注；用具区先显示固定项，再显示自定义项。被酒款引用的杯具或用具不允许直接删除，提示关联数量。

- [ ] **Step 3: 接入录入和详情页**

录入页可选择杯具和多选用具；展示配方总体积与杯具剩余空间，超容量只提醒不阻止保存。

- [ ] **Step 4: 校验与提交**

Run: `npm run check`  
Expected: 全部 PASS。

```bash
git add miniprogram/pages/settings miniprogram/pages/recipe-edit miniprogram/pages/recipe-detail tests/settings.test.js
git commit -m "feat: manage glassware and bar tools"
```

### Task 12: 集成验收、可访问性和交付说明

**Files:**
- Create: `README.md`
- Create: `docs/manual-qa.md`
- Modify: relevant `miniprogram/**/*.wxml`
- Modify: relevant `miniprogram/**/*.wxss`

- [ ] **Step 1: 运行自动化验证**

Run: `npm run check`  
Expected: 所有 JS 语法检查与 Node 测试 PASS，0 failures。

- [ ] **Step 2: 在微信开发者工具执行 PRD 主路径**

按 PRD 第 13 节逐项验证 17 个步骤，并将结果记录在 `docs/manual-qa.md`。如果当前环境无法启动微信开发者工具，明确标记哪些检查需要用户本机完成，不伪造结果。

- [ ] **Step 3: 做前端一致性检查**

确认：点击区域不小于约 44px、长材料名可换行、空状态有明确动作、灰色仍可读、琥珀色不只依赖颜色而同时有图标、删除/用完语义不同、所有表单错误就地显示。

- [ ] **Step 4: 写运行说明**

README 包含微信开发者工具导入路径、游客 AppID/正式 AppID 替换、本地数据位置、清空数据方法、测试命令、MVP 已知限制（无登录/云同步、无多批次、固体不参与 ABV、补满按 100ml）。

- [ ] **Step 5: 最终验证并提交**

Run: `npm run check && git status --short`  
Expected: 测试 PASS；提交前只有预期文档/UI 修改。

```bash
git add README.md docs miniprogram
git commit -m "docs: verify and document cocktail mini program MVP"
```

## 完成标准

- 微信开发者工具能够直接导入并打开小程序；
- `npm run check` 全部通过；
- PRD 第 13 节主路径均已实现，不能在当前环境验证的微信 UI 项明确列入人工 QA；
- 页面不直接调用存储 API，所有数据通过 repository；
- 没有登录、云同步、OCR、公共配方库、自动扣减或多批次库存等后置功能；
- 分支保持可回滚的小步提交。
