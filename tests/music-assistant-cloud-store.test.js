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

test('cloud store puts readable song profile fields first and drops duplicate preferred titles', async () => {
  const store = createMusicStore(memoryDatabase())
  const saved = await store.saveProfile('owner-a', {
    songId: '1',
    cacheKey: 'profile-v2',
    title: '夜航',
    artist: '甲',
    album: '城市',
    emotion_keywords: ['克制'],
    scene_sensory_keywords: ['夜路'],
    summary: '一段夜间独行',
    fitScore: 8.5,
    preferredTitle: '重复歌名',
    preferred_title: '重复歌名'
  })

  assert.deepEqual(Object.keys(saved).slice(0, 7), [
    'title',
    'artist',
    'album',
    'emotion_keywords',
    'scene_sensory_keywords',
    'summary',
    'fitScore'
  ])
  assert.equal(Object.hasOwn(saved, 'preferredTitle'), false)
  assert.equal(Object.hasOwn(saved, 'preferred_title'), false)
})

test('cloud store single-account claim rejects another WeChat owner', async () => {
  const store = createMusicStore(memoryDatabase())
  assert.equal(await store.checkNcmOwner('owner-a'), false)
  await store.claimNcmOwner('owner-a')
  assert.equal(await store.checkNcmOwner('owner-a'), true)
  await assert.rejects(store.claimNcmOwner('owner-b'), (error) => error.code === 'NCM_OWNER_MISMATCH')
})

test('cloud store returns each runnable job once despite the latest-job mirror', async () => {
  const store = createMusicStore(memoryDatabase())
  await store.saveJob('owner-a', { id: 'job-1', status: 'queued', updatedAt: '2026-08-15T12:00:00.000Z' })
  await store.saveJob('owner-b', { id: 'job-2', status: 'running', updatedAt: '2026-08-15T12:01:00.000Z' })
  await store.saveJob('owner-c', { id: 'job-3', status: 'completed', updatedAt: '2026-08-15T12:02:00.000Z' })

  const jobs = await store.listRunnableJobs(10)
  assert.deepEqual(jobs.map((job) => `${job.ownerOpenId}:${job.id}`).sort(), ['owner-a:job-1', 'owner-b:job-2'])
})

test('background updates to an older job do not replace the latest user task', async () => {
  const store = createMusicStore(memoryDatabase())
  await store.saveJob('owner-a', { id: 'job-1', status: 'queued' })
  await store.saveJob('owner-a', { id: 'job-2', status: 'queued' })

  await store.saveJobState('owner-a', { id: 'job-1', status: 'paused' })
  assert.equal((await store.getLatestJob('owner-a')).id, 'job-2')

  await store.saveJobState('owner-a', { id: 'job-2', status: 'completed' })
  assert.equal((await store.getLatestJob('owner-a')).status, 'completed')
})
