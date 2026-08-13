const ENTITY_COLLECTIONS = [
  ['recipe', 'recipes'],
  ['material', 'materials'],
  ['glassware', 'glassware'],
  ['tool', 'tools']
]

const TRASH_RETENTION_MS = 3 * 24 * 60 * 60 * 1000
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function diffStateChanges(previousState, nextState) {
  const previous = previousState && typeof previousState === 'object' ? previousState : {}
  const next = nextState && typeof nextState === 'object' ? nextState : {}
  const changes = {}
  for (const [, collection] of ENTITY_COLLECTIONS) {
    const before = Array.isArray(previous[collection]) ? previous[collection] : []
    const after = Array.isArray(next[collection]) ? next[collection] : []
    const beforeById = new Map(before.filter((item) => item && item.id).map((item) => [item.id, item]))
    const afterIds = new Set(after.filter((item) => item && item.id).map((item) => item.id))
    changes[collection] = {
      upserts: after.filter((item) => item && item.id && !sameValue(beforeById.get(item.id), item)).map(clone),
      deletes: before.filter((item) => item && item.id && !afterIds.has(item.id)).map((item) => item.id)
    }
  }
  return changes
}

function applyStateChanges(baseState, changes) {
  const next = clone(baseState && typeof baseState === 'object' ? baseState : {})
  for (const [, collection] of ENTITY_COLLECTIONS) {
    const change = changes && changes[collection] || {}
    const deletes = new Set(Array.isArray(change.deletes) ? change.deletes : [])
    const upserts = Array.isArray(change.upserts) ? change.upserts : []
    const upsertsById = new Map(upserts.filter((item) => item && item.id).map((item) => [item.id, item]))
    const current = Array.isArray(next[collection]) ? next[collection] : []
    const merged = current
      .filter((item) => !item || !item.id || !deletes.has(item.id))
      .map((item) => item && item.id && upsertsById.has(item.id) ? clone(upsertsById.get(item.id)) : item)
    const existingIds = new Set(merged.filter((item) => item && item.id).map((item) => item.id))
    for (const item of upserts) {
      if (item && item.id && !existingIds.has(item.id)) {
        merged.push(clone(item))
        existingIds.add(item.id)
      }
    }
    next[collection] = merged
  }
  return next
}

function diffDeletedItems(previousState, nextState, deletedAt, requestId) {
  const previous = previousState && typeof previousState === 'object' ? previousState : {}
  const next = nextState && typeof nextState === 'object' ? nextState : {}
  const timestamp = new Date(deletedAt)
  if (!Number.isFinite(timestamp.getTime())) throw new RangeError('Invalid deletion time')
  const expiresAt = new Date(timestamp.getTime() + TRASH_RETENTION_MS).toISOString()
  const deleted = []
  for (const [entityType, collection] of ENTITY_COLLECTIONS) {
    const liveIds = new Set((Array.isArray(next[collection]) ? next[collection] : []).map((item) => item && item.id).filter(Boolean))
    for (const item of Array.isArray(previous[collection]) ? previous[collection] : []) {
      if (!item || !item.id || liveIds.has(item.id)) continue
      deleted.push({ entityType, item: clone(item), deletedAt: timestamp.toISOString(), expiresAt, requestId: String(requestId || '') })
    }
  }
  return deleted
}

function restoreTrashItem(state, entry) {
  const mapping = new Map(ENTITY_COLLECTIONS)
  const collection = mapping.get(entry && entry.entityType)
  if (!collection || !entry.item || !entry.item.id) throw new RangeError('无效的回收站记录')
  const next = clone(state && typeof state === 'object' ? state : {})
  if (!Array.isArray(next[collection])) next[collection] = []
  if (next[collection].some((item) => item && item.id === entry.item.id)) throw new Error('同名记录已经存在，无法覆盖')
  next[collection].push(clone(entry.item))
  return next
}

module.exports = {
  ENTITY_COLLECTIONS,
  TRASH_RETENTION_MS,
  HISTORY_RETENTION_MS,
  diffStateChanges,
  applyStateChanges,
  diffDeletedItems,
  restoreTrashItem
}
