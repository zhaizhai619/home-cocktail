const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { createInitialState } = require('../miniprogram/services/schema')
const { createWxBackupService } = require('../miniprogram/services/cloud-backup')

test('backup export writes the confirmed cloud snapshot as readable JSON', async () => {
  const writes = []
  const service = createWxBackupService({
    env: { USER_DATA_PATH: '/user' },
    getFileSystemManager() {
      return {
        writeFile(options) {
          writes.push(options)
          options.success()
        }
      }
    }
  }, { now: () => new Date('2026-08-01T12:34:56.000Z') })
  const state = createInitialState()
  state.recipes.push({ id: 'r1', name: '云端酒单' })

  const result = await service.exportSnapshot({ state, profile: { id: 'ABC123', nickname: '阿孟' }, revision: 7, syncedAt: '2026-08-01T12:00:00.000Z' })

  assert.equal(result.filePath, '/user/cocktail-backup-2026-08-01-123456.json')
  assert.equal(writes[0].encoding, 'utf8')
  const parsed = JSON.parse(writes[0].data)
  assert.equal(parsed.format, 'home-cocktail-backup')
  assert.equal(parsed.exportedAt, '2026-08-01T12:34:56.000Z')
  assert.equal(parsed.snapshot.state.recipes[0].name, '云端酒单')
  assert.equal(parsed.snapshot.revision, 7)
})

test('trash and backup pages are registered and settings exposes both actions', () => {
  const app = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'))
  const template = fs.readFileSync('miniprogram/pages/settings/index.wxml', 'utf8')
  const css = fs.readFileSync('miniprogram/pages/settings/index.wxss', 'utf8')
  assert.ok(app.pages.includes('pages/trash/index'))
  for (const extension of ['js', 'json', 'wxml', 'wxss']) assert.equal(fs.existsSync(`miniprogram/pages/trash/index.${extension}`), true)
  assert.match(template, /bindtap="onOpenTrash"/)
  assert.match(template, /bindtap="onExportBackup"/)
  assert.match(template, /<view class="data-action"[^>]*bindtap="onOpenTrash"/)
  assert.match(template, /<view class="data-action"[^>]*bindtap="onExportBackup"/)
  assert.match(template, /class="nickname-input"[\s\S]*>点击头像和名字即可编辑<[\s\S]*class="data-panel"/)
  assert.match(template, /class="data-panel"[\s\S]*class="sync-row"[\s\S]*bindtap="onOpenTrash"[\s\S]*bindtap="onExportBackup"/)
  assert.match(template, />3 天内可恢复</)
  assert.match(template, />保存一份 JSON 文件</)
  assert.doesNotMatch(template, /class="data-actions"/)
  assert.match(css, /\.data-panel\s*{[^}]*background:\s*transparent[^}]*border:\s*1rpx solid #e7e4dd/)
  assert.match(css, /\.sync-label,\s*\.data-action-title\s*{[^}]*font-weight:\s*400/)
  assert.match(css, /\.sync-label,\s*\.data-action-title\s*{[^}]*width:\s*180rpx[^}]*flex-shrink:\s*0[^}]*text-align:\s*left[^}]*white-space:\s*nowrap/)
  assert.match(css, /\.sync-value,\s*\.action-note\s*{[^}]*flex:\s*1[^}]*text-align:\s*right[^}]*white-space:\s*nowrap/)
})
