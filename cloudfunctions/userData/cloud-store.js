const crypto = require('crypto')

const USER_COLLECTION = 'user_data'
const HISTORY_COLLECTION = 'user_history'
const TRASH_COLLECTION = 'user_trash'
const ENTITY_COLLECTION = 'user_entities'
const COLLECTIONS = [USER_COLLECTION, HISTORY_COLLECTION, TRASH_COLLECTION, ENTITY_COLLECTION]
const ENTITY_PAGE_SIZE = 100

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function isMissingDocument(error) {
  const message = String(error && (error.errMsg || error.message) || '')
  return /not exist|does not exist|DOCUMENT_NOT_FOUND|-502005/i.test(message)
}

function isMissingCollection(error) {
  const message = String(error && (error.errMsg || error.message) || '')
  return /collection.*not exist|DATABASE_COLLECTION_NOT_EXIST|-502005/i.test(message)
}

function entityDocumentId(openId, entityType, entityId) {
  return crypto.createHash('sha256').update(`${openId}:${entityType}:${entityId}`).digest('hex')
}

async function readDocument(database, collection, id) {
  try {
    const result = await database.collection(collection).doc(id).get()
    return result && result.data ? clone(result.data) : null
  } catch (error) {
    if (isMissingDocument(error)) return null
    throw error
  }
}

function transactionStore(transaction) {
  return {
    getUser(openId) { return readDocument(transaction, USER_COLLECTION, openId) },
    setUser(openId, value) {
      const data = clone(value)
      if (data && typeof data === 'object') delete data._id
      return transaction.collection(USER_COLLECTION).doc(openId).set({ data })
    },
    addHistory(value) { return transaction.collection(HISTORY_COLLECTION).add({ data: clone(value) }) },
    addTrash(value) { return transaction.collection(TRASH_COLLECTION).add({ data: clone(value) }) },
    getEntityChange(openId, entityType, entityId) {
      return readDocument(transaction, ENTITY_COLLECTION, entityDocumentId(openId, entityType, entityId))
    },
    setEntityChange(openId, entityType, entityId, value) {
      return transaction.collection(ENTITY_COLLECTION).doc(entityDocumentId(openId, entityType, entityId)).set({
        data: { ownerOpenId: openId, entityType, entityId, ...clone(value) }
      })
    },
    getTrash(id) { return readDocument(transaction, TRASH_COLLECTION, id) },
    markTrashRestored(id, restoredAt) {
      return transaction.collection(TRASH_COLLECTION).doc(id).update({ data: { restoredAt } })
    }
  }
}

function createCloudStore(db) {
  if (!db || typeof db.collection !== 'function') throw new Error('Cloud database unavailable')
  const command = db.command
  let collectionsReady = null

  async function ensureCollections() {
    if (!collectionsReady) {
      collectionsReady = Promise.all(COLLECTIONS.map(async (name) => {
        try {
          await db.collection(name).limit(1).get()
        } catch (error) {
          if (!isMissingCollection(error) || typeof db.createCollection !== 'function') throw error
          try { await db.createCollection(name) } catch (createError) {
            if (!/already exist|已存在/i.test(String(createError && (createError.errMsg || createError.message)))) throw createError
          }
        }
      })).catch((error) => {
        collectionsReady = null
        throw error
      })
    }
    return collectionsReady
  }

  async function transaction(work) {
    await ensureCollections()
    return db.runTransaction((cloudTransaction) => work(transactionStore(cloudTransaction)))
  }

  async function listTrash(openId, at) {
    await ensureCollections()
    const result = await db.collection(TRASH_COLLECTION).where({ ownerOpenId: openId }).limit(100).get()
    return (result && result.data || [])
      .filter((item) => item && !item.restoredAt && item.expiresAt > at)
      .sort((left, right) => String(right.deletedAt || '').localeCompare(String(left.deletedAt || '')))
      .map((item) => ({ ...clone(item), id: item._id }))
  }

  async function listEntityChanges(openId) {
    await ensureCollections()
    const entries = []
    let offset = 0
    while (true) {
      const result = await db.collection(ENTITY_COLLECTION)
        .where({ ownerOpenId: openId })
        .skip(offset)
        .limit(ENTITY_PAGE_SIZE)
        .get()
      const page = result && result.data || []
      entries.push(...page.map(clone))
      if (page.length < ENTITY_PAGE_SIZE) return entries
      offset += page.length
    }
  }

  async function removeWhere(collection, condition) {
    const result = await db.collection(collection).where(condition).remove()
    return Number(result && result.stats && result.stats.removed || 0)
  }

  async function deleteExpired(at) {
    await ensureCollections()
    const expiredTrash = await removeWhere(TRASH_COLLECTION, { expiresAt: command.lte(at) })
    const restoredTrash = await removeWhere(TRASH_COLLECTION, { restoredAt: command.exists(true) })
    const expiredHistory = await removeWhere(HISTORY_COLLECTION, { expiresAt: command.lte(at) })
    return { trash: expiredTrash + restoredTrash, history: expiredHistory }
  }

  return {
    ensureCollections,
    transaction,
    async getUser(openId) {
      await ensureCollections()
      return readDocument(db, USER_COLLECTION, openId)
    },
    listEntityChanges,
    listTrash,
    deleteExpired
  }
}

module.exports = {
  USER_COLLECTION,
  HISTORY_COLLECTION,
  TRASH_COLLECTION,
  ENTITY_COLLECTION,
  entityDocumentId,
  createCloudStore
}
