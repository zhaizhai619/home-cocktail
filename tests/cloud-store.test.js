const test = require('node:test')
const assert = require('node:assert/strict')

const { createCloudStore } = require('../cloudfunctions/userData/cloud-store')

test('cloud store never sends the database _id field back in document data', async () => {
  const writes = []
  function collection(name) {
    return {
      limit() { return { async get() { return { data: [] } } } },
      doc(id) {
        return {
          async get() { return { data: { _id: id, ownerOpenId: id, revision: 1 } } },
          async set({ data }) { writes.push({ name, id, data }) }
        }
      },
      async add() { return {} }
    }
  }
  const db = {
    collection,
    command: {},
    async runTransaction(work) { return work({ collection }) }
  }
  const store = createCloudStore(db)

  await store.transaction(async (transaction) => {
    const current = await transaction.getUser('openid-a')
    await transaction.setUser('openid-a', { ...current, revision: 2 })
  })

  assert.equal(Object.prototype.hasOwnProperty.call(writes[0].data, '_id'), false)
  assert.equal(writes[0].data.ownerOpenId, 'openid-a')
  assert.equal(writes[0].data.revision, 2)
})
