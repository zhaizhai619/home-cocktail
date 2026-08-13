const test = require('node:test')
const assert = require('node:assert/strict')

const { createMusicStore } = require('../cloudfunctions/musicAssistant/cloud-store')

function memoryDatabase() {
  const collections = new Map()
  const values = (name) => {
    if (!collections.has(name)) collections.set(name, new Map())
    return collections.get(name)
  }
  function collection(name) {
    const rows = values(name)
    return {
      limit(max) { return { async get() { return { data: [...rows.values()].slice(0, max) } } } },
      where(condition) {
        const filtered = () => [...rows.values()].filter((row) => Object.entries(condition).every(([key, value]) => row[key] === value))
        return {
          limit(max) { return { async get() { return { data: filtered().slice(0, max) } } } },
          async count() { return { total: filtered().length } }
        }
      },
      doc(id) {
        return {
          async get() {
            if (!rows.has(id)) throw new Error('document does not exist')
            return { data: { _id: id, ...rows.get(id) } }
          },
          async set({ data }) { rows.set(id, JSON.parse(JSON.stringify(data))) }
        }
      }
    }
  }
  return { collection, async runTransaction(work) { return work({ collection }) } }
}

test('cloud store keeps one current profile and an atomic per-song lease', async () => {
  const store = createMusicStore(memoryDatabase())
  const job = { id: 'job-1', songIds: ['1'], results: {}, status: 'queued', createdAt: '2026-08-03T00:00:00.000Z' }
  await store.saveJob('owner-a', job)

  const first = await store.claimSong('owner-a', 'job-1', '1', { token: 'lease-a', now: '2026-08-03T00:00:01.000Z', expiresAt: '2026-08-03T00:02:01.000Z' })
  const duplicate = await store.claimSong('owner-a', 'job-1', '1', { token: 'lease-b', now: '2026-08-03T00:00:02.000Z', expiresAt: '2026-08-03T00:02:02.000Z' })
  assert.equal(first.claimed, true)
  assert.equal(duplicate.claimed, false)

  await store.finishSongClaim('owner-a', { ...first.job, status: 'completed', results: { 1: { status: 'completed' } } }, 'lease-a')
  assert.equal((await store.getJob('owner-a', 'job-1')).lease, undefined)

  await store.saveProfile('owner-a', { songId: '1', cacheKey: 'flash', model: 'flash' })
  await store.saveProfile('owner-a', { songId: '1', cacheKey: 'pro', model: 'pro' })
  assert.equal((await store.listProfiles('owner-a')).length, 1)
  assert.equal((await store.listProfiles('owner-a'))[0].model, 'pro')
  assert.equal((await store.findProfile('owner-a', 'flash')).model, 'flash')
})

test('cloud store single-account claim rejects another WeChat owner', async () => {
  const store = createMusicStore(memoryDatabase())
  assert.equal(await store.checkNcmOwner('owner-a'), false)
  await store.claimNcmOwner('owner-a')
  assert.equal(await store.checkNcmOwner('owner-a'), true)
  await assert.rejects(store.claimNcmOwner('owner-b'), (error) => error.code === 'NCM_OWNER_MISMATCH')
})
