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

module.exports = { ENTITY_COLLECTIONS, TRASH_RETENTION_MS, HISTORY_RETENTION_MS, diffDeletedItems, restoreTrashItem }
