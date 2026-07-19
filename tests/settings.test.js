const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { QUICK_TOOLS } = require('../miniprogram/domain/constants')
const { calculateGlassCapacity } = require('../miniprogram/domain/equipment')
const { createRepository } = require('../miniprogram/services/repository')
const { STORAGE_KEY, migrateState } = require('../miniprogram/services/schema')
const { createMediaFileService } = require('../miniprogram/services/media-files')
const {
  buildSettingsView,
  validateGlasswareForm,
  validateToolForm,
  orchestrateGlasswareSave,
  orchestrateToolSave,
  orchestrateEquipmentDelete,
  orchestrateGlasswareMediaSave,
  orchestrateGlasswareMediaDelete,
  createEditorOperationGuard
} = require('../miniprogram/pages/settings/model')
const { buildRecipeDetail } = require('../miniprogram/pages/recipe-detail/model')
const { createEmptyRecipeForm, hydrateEquipmentSelections, getFormPreview } = require('../miniprogram/pages/recipe-edit/model')

function memoryAdapter(initial) {
  const values = new Map(initial ? [[STORAGE_KEY, structuredClone(initial)]] : [])
  let fail = false
  return {
    get(key) { return structuredClone(values.get(key)) },
    set(key, value) {
      if (fail) { fail = false; throw new Error('storage unavailable') }
      values.set(key, structuredClone(value))
    },
    failNextWrite() { fail = true },
    read() { return structuredClone(values.get(STORAGE_KEY)) }
  }
}

function repositoryFixture() {
  let id = 0
  const adapter = memoryAdapter()
  const repository = createRepository(adapter, { idFactory: () => `id-${++id}` })
  repository.initialize()
  return { repository, adapter }
}

test('glassware CRUD normalizes fields, validates capacity, and prevents duplicate names', () => {
  const { repository } = repositoryFixture()
  const created = repository.upsertGlassware({ name: '  海波  杯 ', capacityMl: '320.5', imagePath: ' /glass.png ', notes: '  冰镇 ' })
  assert.deepEqual(created, { id: 'id-1', name: '海波 杯', capacityMl: 320.5, imagePath: '/glass.png', notes: '冰镇' })
  const updated = repository.upsertGlassware({ id: created.id, name: '柯林杯', capacityMl: 350, imagePath: '', notes: '' })
  assert.equal(updated.id, created.id)
  assert.deepEqual(repository.getGlassware(created.id), updated)
  assert.throws(() => repository.upsertGlassware({ name: '  柯林杯 ', capacityMl: 300 }), /已存在/)
  for (const capacityMl of ['', 0, -1, 'abc', 5000.1]) {
    assert.throws(() => repository.upsertGlassware({ name: `坏杯${capacityMl}`, capacityMl }), /容量/)
  }
})

test('custom tool CRUD protects built-ins and duplicate names while retaining stable IDs on rename', () => {
  const { repository } = repositoryFixture()
  const custom = repository.upsertTool({ name: '  喷  枪 ' })
  assert.deepEqual(custom, { id: 'id-1', name: '喷 枪', builtIn: false })
  const renamed = repository.upsertTool({ id: custom.id, name: '烟熏枪' })
  assert.equal(renamed.id, custom.id)
  assert.throws(() => repository.upsertTool({ name: '烟熏枪' }), /已存在/)
  assert.throws(() => repository.upsertTool({ name: QUICK_TOOLS[0] }), /已存在/)
  assert.throws(() => repository.upsertTool({ id: 'quick-tool-1', name: '改名' }), /固定用具/)
  assert.equal(repository.deleteTool('quick-tool-1'), false)
})

test('equipment deletion is blocked by recipe references and reports the usage count separately', () => {
  const { repository } = repositoryFixture()
  const glass = repository.upsertGlassware({ name: '海波杯', capacityMl: 300 })
  const tool = repository.upsertTool({ name: '喷枪' })
  repository.upsertRecipe({ name: 'A', glasswareId: glass.id, toolIds: [tool.id] })
  repository.upsertRecipe({ name: 'B', glasswareId: glass.id, toolIds: [tool.id] })

  assert.equal(repository.getGlasswareUsageCount(glass.id), 2)
  assert.equal(repository.getToolUsageCount(tool.id), 2)
  assert.equal(repository.deleteGlassware(glass.id), false)
  assert.equal(repository.deleteTool(tool.id), false)
  assert.ok(repository.getGlassware(glass.id))
  assert.ok(repository.getTool(tool.id))
})

test('all equipment writes are atomic when storage fails', () => {
  for (const operation of ['create-glass', 'update-glass', 'delete-glass', 'create-tool', 'update-tool', 'delete-tool']) {
    const { repository, adapter } = repositoryFixture()
    const glass = repository.upsertGlassware({ name: '海波杯', capacityMl: 300 })
    const tool = repository.upsertTool({ name: '喷枪' })
    const beforeMemory = repository.getState()
    const beforeStorage = adapter.read()
    adapter.failNextWrite()
    assert.throws(() => {
      if (operation === 'create-glass') repository.upsertGlassware({ name: '古典杯', capacityMl: 250 })
      if (operation === 'update-glass') repository.upsertGlassware({ ...glass, name: '柯林杯' })
      if (operation === 'delete-glass') repository.deleteGlassware(glass.id)
      if (operation === 'create-tool') repository.upsertTool({ name: '削皮刀' })
      if (operation === 'update-tool') repository.upsertTool({ ...tool, name: '烟熏枪' })
      if (operation === 'delete-tool') repository.deleteTool(tool.id)
    }, /storage unavailable/, operation)
    assert.deepEqual(repository.getState(), beforeMemory, `${operation} memory`)
    assert.deepEqual(adapter.read(), beforeStorage, `${operation} storage`)
  }
})

test('legacy equipment is normalized safely and orphan recipe references are preserved', () => {
  const state = migrateState({
    glassware: [{ id: 'g1', name: ' Legacy ', capacity: 280, note: 'old' }],
    tools: [{ id: 't1', name: ' Custom ' }],
    recipes: [{ id: 'r1', glasswareId: 'missing-glass', toolIds: ['missing-tool', 't1'] }]
  }, '2026-01-01T00:00:00.000Z')
  assert.deepEqual(state.glassware[0], { id: 'g1', name: 'Legacy', capacityMl: 280, imagePath: '', notes: 'old' })
  assert.equal(state.tools.find((tool) => tool.id === 't1').name, 'Custom')
  assert.equal(state.recipes[0].glasswareId, 'missing-glass')
  assert.deepEqual(state.recipes[0].toolIds, ['missing-tool', 't1'])
})

test('capacity calculation shares the 100ml top-up rule and distinguishes all display states', () => {
  const base = [
    { name: '金酒', category: 'base-spirit', amount: 40, unit: 'ml', alcoholic: true, abv: 40 },
    { name: '汤力水', category: 'soda/tonic', amount: null, unit: 'top-up', alcoholic: false }
  ]
  assert.deepEqual(calculateGlassCapacity(base, { capacityMl: 200 }), { status: 'under', liquidVolume: 140, capacityMl: 200, differenceMl: 60, message: '预计液体体积 140ml / 杯具 200ml / 约剩 60ml', ignored: [] })
  assert.equal(calculateGlassCapacity(base, { capacityMl: 140 }).status, 'exact')
  assert.deepEqual(calculateGlassCapacity(base, { capacityMl: 100 }), { status: 'over', liquidVolume: 140, capacityMl: 100, differenceMl: 40, message: '预计液体体积 140ml / 杯具 100ml / 预计超出 40ml', ignored: [] })
  assert.equal(calculateGlassCapacity(base, null).status, 'no-glass')
  assert.deepEqual(calculateGlassCapacity(base, { id: 'legacy', name: '旧杯具', capacityMl: null }), { status: 'invalid-glass', liquidVolume: 140, capacityMl: null, differenceMl: null, message: '杯具容量资料缺失，请先到“我的”中补充', ignored: [] })
  const incomplete = calculateGlassCapacity([{ name: '果汁', category: 'other-liquid', amount: '', unit: 'ml', alcoholic: false }], { capacityMl: 200 })
  assert.deepEqual(incomplete, { status: 'incomplete', liquidVolume: 0, capacityMl: 200, differenceMl: null, message: '总体积信息不完整', ignored: [] })
})

test('capacity ignores nonalcoholic drops and reports them without losing a precise liquid total', () => {
  const result = calculateGlassCapacity([
    { name: '金酒', amount: 40, unit: 'ml', alcoholic: true, abv: 40 },
    { name: '盐水', amount: 2, unit: 'drop', alcoholic: false }
  ], { capacityMl: 100 })

  assert.deepEqual(result, {
    status: 'under', liquidVolume: 40, capacityMl: 100, differenceMl: 60,
    message: '预计液体体积 40ml / 杯具 100ml / 约剩 60ml', ignored: ['盐水']
  })
})

test('settings model groups built-ins, validates forms, orchestrates writes, and explains referenced deletion', () => {
  const recipes = [{ id: 'r1', glasswareId: 'g1', toolIds: ['t1'] }]
  const view = buildSettingsView(
    [{ id: 'g1', name: '海波杯', capacityMl: 300 }],
    [{ id: 'quick-tool-1', name: '摇酒壶', builtIn: true }, { id: 't1', name: '喷枪', builtIn: false }],
    recipes
  )
  assert.equal(view.glassware[0].usageCount, 1)
  assert.equal(buildSettingsView([{ id: 'legacy', name: '旧杯', capacityMl: null }], [], []).glassware[0].capacityLabel, '容量待补充')
  assert.deepEqual(view.builtInTools.map(({ name }) => name), ['摇酒壶'])
  assert.equal(view.customTools[0].usageCount, 1)
  assert.equal(validateGlasswareForm({ name: '', capacityMl: 100 }).valid, false)
  assert.equal(validateGlasswareForm({ name: '杯', capacityMl: 100 }).valid, true)
  assert.equal(validateToolForm({ name: ' ' }).valid, false)

  const calls = []; const messages = []
  assert.equal(orchestrateGlasswareSave({ repository: { upsertGlassware(value) { calls.push(value); return { id: 'g1' } }, }, form: { name: ' 杯 ', capacityMl: '120' }, notify: (m) => messages.push(m) }).saved, true)
  assert.equal(orchestrateToolSave({ repository: { upsertTool(value) { calls.push(value); return { id: 't1' } } }, form: { name: ' 喷枪 ' }, notify: (m) => messages.push(m) }).saved, true)
  assert.equal(orchestrateEquipmentDelete({ repository: { getGlasswareUsageCount: () => 2 }, type: 'glassware', id: 'g1', notify: (m) => messages.push(m) }).needsConfirmation, false)
  assert.match(messages.at(-1), /2 款酒/)
})

test('recipe editor and detail hydrate latest equipment, retain orphans, and use one capacity helper', () => {
  const form = { ...createEmptyRecipeForm(), glasswareId: 'g1', toolIds: ['quick-tool-1', 'gone-tool'], ingredients: [
    { name: '金酒', category: 'base-spirit', amount: 50, unit: 'ml', alcoholic: true, abv: 40 },
    { name: '苏打水', category: 'soda/tonic', amount: null, unit: 'top-up', alcoholic: false }
  ] }
  const hydrated = hydrateEquipmentSelections(form, [{ id: 'g1', name: '新名字', capacityMl: 160 }], [{ id: 'quick-tool-1', name: '摇酒壶', builtIn: true }])
  assert.equal(hydrated.glasswareLabel, '新名字')
  assert.equal(hydrated.tools.find(({ id }) => id === 'gone-tool').orphaned, true)
  assert.equal(hydrated.tools.find(({ id }) => id === 'gone-tool').selected, true)
  assert.equal(hydrated.capacity.message, '预计液体体积 150ml / 杯具 160ml / 约剩 10ml')
  assert.equal(getFormPreview(form).liquidVolume, 150)

  const detail = buildRecipeDetail({ id: 'r1', name: '酒', glasswareId: 'g1', toolIds: ['quick-tool-1', 'gone-tool'], ingredients: [{ materialId: 'gin', amount: 50, unit: 'ml' }] }, [{ id: 'gin', name: '金酒', form: 'liquid', alcoholic: true, abv: 40, owned: true, acquisition: 'long-term' }], [{ id: 'g1', name: '新名字', capacityMl: 40, imagePath: '/g.png', notes: '冷藏' }], [{ id: 'quick-tool-1', name: '摇酒壶', builtIn: true }])
  assert.equal(detail.glassware.name, '新名字')
  assert.equal(detail.glassware.imagePath, '/g.png')
  assert.equal(detail.glassware.notes, '冷藏')
  assert.equal(detail.capacity.status, 'over')
  assert.equal(detail.tools[1].orphaned, true)

  const legacyCapacity = buildRecipeDetail({ id: 'legacy', name: '旧酒', glasswareId: 'legacy-glass', ingredients: [{ materialId: 'gin', amount: 50, unit: 'ml' }] }, [{ id: 'gin', name: '金酒', alcoholic: true, abv: 40, acquisition: 'long-term', owned: true }], [{ id: 'legacy-glass', name: '旧杯', capacityMl: null }], [])
  assert.equal(legacyCapacity.glassware.capacityLabel, '容量待补充')
  assert.equal(legacyCapacity.capacity.status, 'invalid-glass')
  assert.equal(legacyCapacity.capacity.differenceMl, null)
})

test('settings and recipe pages expose the expected route events and non-color status text', () => {
  const settings = fs.readFileSync('miniprogram/pages/settings/index.wxml', 'utf8')
  const editor = fs.readFileSync('miniprogram/pages/recipe-edit/index.wxml', 'utf8')
  const detail = fs.readFileSync('miniprogram/pages/recipe-detail/index.wxml', 'utf8')
  for (const handler of ['onAddGlassware', 'onEditGlassware', 'onRequestDeleteGlassware', 'onAddTool', 'onEditTool', 'onRequestDeleteTool']) assert.match(settings, new RegExp(`bindtap="${handler}"`))
  assert.match(settings, /固定用具/)
  assert.match(settings, /自定义用具/)
  assert.match(editor, /preview\.capacity\.message/)
  assert.match(editor, /资料缺失/)
  assert.match(detail, /detail\.capacity\.message/)
  assert.match(settings, /disabled="{{savingGlass}}"/)
  assert.match(settings, /loading="{{savingGlass}}"/)
})

test('editor operation guard prevents double saves and unlocks after success or failure', async () => {
  const guard = createEditorOperationGuard()
  let copies = 0; let saves = 0; let release
  const pending = new Promise((resolve) => { release = resolve })
  async function guardedSave(fail = false) {
    const token = guard.begin()
    if (!token) return { started: false }
    try {
      copies += 1
      await pending
      if (fail) throw new Error('failed')
      saves += 1
      return { started: true }
    } finally { guard.finish(token) }
  }

  const first = guardedSave()
  const second = await guardedSave()
  assert.equal(second.started, false)
  assert.equal(copies, 1)
  assert.equal(guard.canMutateEditor(), false)
  release()
  await first
  assert.equal(saves, 1)
  assert.equal(guard.canMutateEditor(), true)

  let rejectRelease
  const failingPending = new Promise((resolve) => { rejectRelease = resolve })
  const failureGuard = createEditorOperationGuard()
  const token = failureGuard.begin()
  const failing = (async () => { try { await failingPending; throw new Error('failed') } finally { failureGuard.finish(token) } })()
  assert.equal(failureGuard.canMutateEditor(), false)
  rejectRelease()
  await assert.rejects(failing, /failed/)
  assert.equal(failureGuard.canMutateEditor(), true)
})

test('media service copies temporary glass images to a unique managed path and never deletes external files', async () => {
  const calls = []
  const fileSystem = {
    mkdir({ success }) { calls.push(['mkdir']); success() },
    copyFile({ srcPath, destPath, success }) { calls.push(['copy', srcPath, destPath]); success() },
    unlink({ filePath, success }) { calls.push(['unlink', filePath]); success() }
  }
  const service = createMediaFileService({ fileSystem, userDataPath: '/user', idFactory: (() => { let id = 0; return () => `image-${++id}` })() })

  const first = await service.persistGlasswareImage('/tmp/photo.jpg')
  const second = await service.persistGlasswareImage('/tmp/photo.jpg')
  assert.equal(first.path, '/user/cocktail-glassware/image-1.jpg')
  assert.equal(second.path, '/user/cocktail-glassware/image-2.jpg')
  assert.equal(first.created, true)
  assert.equal((await service.persistGlasswareImage(first.path)).created, false)
  assert.equal(calls.filter(([kind]) => kind === 'copy').length, 2)
  assert.deepEqual(await service.removeManagedFile('/tmp/not-ours.jpg'), { removed: false })
  assert.deepEqual(await service.removeManagedFile('/user/cocktail-glassware/../not-ours.jpg'), { removed: false })
  assert.equal(calls.filter(([kind]) => kind === 'unlink').length, 0)
  assert.deepEqual(await service.removeManagedFile(first.path), { removed: true })
})

test('glassware media save coordinates copy, repository commit, replacement cleanup and rollback cleanup', async () => {
  const events = []; const warnings = []; const notices = []
  const mediaFiles = {
    isManagedPath: (path) => String(path).startsWith('/managed/'),
    async persistGlasswareImage(path) { events.push(['copy', path]); if (path === '/tmp/fail.jpg') throw new Error('copy failed'); return { path: '/managed/new.jpg', created: true } },
    async removeManagedFile(path) { events.push(['remove', path]); if (path === '/managed/cleanup-fails.jpg') throw new Error('cleanup failed'); return { removed: true } }
  }
  let stored = { id: 'g1', name: '杯', capacityMl: 100, imagePath: '/managed/old.jpg', notes: '' }
  const repository = {
    getGlassware: () => structuredClone(stored),
    listGlassware: () => [structuredClone(stored)],
    upsertGlassware(value) { events.push(['save', value.imagePath]); stored = { ...value, id: 'g1' }; return stored }
  }

  const replaced = await orchestrateGlasswareMediaSave({ repository, mediaFiles, form: stored, selectedImagePath: '/tmp/new.jpg', notify: (m) => notices.push(m), warn: (m) => warnings.push(m) })
  assert.equal(replaced.saved, true)
  assert.equal(stored.imagePath, '/managed/new.jpg')
  assert.deepEqual(events, [['copy', '/tmp/new.jpg'], ['save', '/managed/new.jpg'], ['remove', '/managed/old.jpg']])

  events.length = 0
  const copyFailure = await orchestrateGlasswareMediaSave({ repository, mediaFiles, form: stored, selectedImagePath: '/tmp/fail.jpg', notify: (m) => notices.push(m) })
  assert.equal(copyFailure.saved, false)
  assert.deepEqual(events, [['copy', '/tmp/fail.jpg']])

  events.length = 0
  const failingRepository = { getGlassware: () => stored, listGlassware: () => [stored], upsertGlassware() { events.push(['save-failed']); throw new Error('storage') } }
  const rollback = await orchestrateGlasswareMediaSave({ repository: failingRepository, mediaFiles, form: stored, selectedImagePath: '/tmp/new.jpg', notify: (m) => notices.push(m), warn: (m) => warnings.push(m) })
  assert.equal(rollback.saved, false)
  assert.deepEqual(events, [['copy', '/tmp/new.jpg'], ['save-failed'], ['remove', '/managed/new.jpg']])

  events.length = 0
  stored.imagePath = '/managed/cleanup-fails.jpg'
  const cleanupWarning = await orchestrateGlasswareMediaSave({ repository, mediaFiles, form: stored, selectedImagePath: '', notify: (m) => notices.push(m), warn: (m) => warnings.push(m) })
  assert.equal(cleanupWarning.saved, true)
  assert.deepEqual(events, [['save', ''], ['remove', '/managed/cleanup-fails.jpg']])
  assert.match(warnings.at(-1), /旧图片清理失败/)

  events.length = 0
  const cleanupLookupFailure = await orchestrateGlasswareMediaSave({
    repository: { getGlassware: () => ({ ...stored, imagePath: '/managed/old-again.jpg' }), upsertGlassware: (value) => ({ ...value, id: 'g1' }), listGlassware() { throw new Error('read failed') } },
    mediaFiles, form: { ...stored, imagePath: '/managed/old-again.jpg' }, selectedImagePath: '',
    notify: (m) => notices.push(m), warn: (m) => warnings.push(m)
  })
  assert.equal(cleanupLookupFailure.saved, true)
  assert.match(warnings.at(-1), /旧图片清理失败/)
})

test('old managed images are cleaned only after their final glassware reference is gone', async () => {
  const removed = []
  const mediaFiles = {
    isManagedPath: (path) => String(path).startsWith('/managed/'),
    async persistGlasswareImage(path) { return { path, created: false } },
    async removeManagedFile(path) { removed.push(path); return { removed: true } }
  }
  let glasses = [
    { id: 'g1', name: '一号杯', capacityMl: 100, imagePath: '/managed/shared.jpg', notes: '' },
    { id: 'g2', name: '二号杯', capacityMl: 120, imagePath: '/managed/shared.jpg', notes: '' }
  ]
  const repository = {
    getGlassware(id) { return structuredClone(glasses.find((item) => item.id === id)) },
    listGlassware() { return structuredClone(glasses) },
    upsertGlassware(value) { const index = glasses.findIndex((item) => item.id === value.id); glasses[index] = { ...value }; return glasses[index] },
    getGlasswareUsageCount: () => 0,
    deleteGlassware(id) { glasses = glasses.filter((item) => item.id !== id); return true }
  }

  await orchestrateGlasswareMediaSave({ repository, mediaFiles, form: glasses[0], selectedImagePath: '' })
  assert.deepEqual(removed, [])
  await orchestrateGlasswareMediaDelete({ repository, mediaFiles, id: 'g2', confirmed: true })
  assert.deepEqual(removed, ['/managed/shared.jpg'])

  removed.length = 0
  glasses = [{ id: 'g3', name: '三号杯', capacityMl: 100, imagePath: '/external/shared.jpg', notes: '' }]
  await orchestrateGlasswareMediaDelete({ repository, mediaFiles, id: 'g3', confirmed: true })
  assert.deepEqual(removed, [])
})

test('glassware deletion cleans its managed image only after repository deletion succeeds', async () => {
  const removed = []
  const mediaFiles = { async removeManagedFile(path) { removed.push(path); return { removed: true } } }
  const repository = {
    getGlassware: () => ({ id: 'g1', imagePath: '/managed/old.jpg' }),
    listGlassware: () => [],
    getGlasswareUsageCount: () => 0,
    deleteGlassware: () => true
  }
  const result = await orchestrateGlasswareMediaDelete({ repository, mediaFiles, id: 'g1', confirmed: true })
  assert.equal(result.deleted, true)
  assert.deepEqual(removed, ['/managed/old.jpg'])

  removed.length = 0
  const failed = await orchestrateGlasswareMediaDelete({ repository: { ...repository, deleteGlassware: () => false }, mediaFiles, id: 'g1', confirmed: true })
  assert.equal(failed.deleted, false)
  assert.deepEqual(removed, [])
})
