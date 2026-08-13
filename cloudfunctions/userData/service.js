const {
  ENTITY_COLLECTIONS,
  TRASH_RETENTION_MS,
  HISTORY_RETENTION_MS,
  diffStateChanges,
  applyStateChanges,
  diffDeletedItems,
  restoreTrashItem
} = require('./domain')

const MAX_SNAPSHOT_BYTES = 800 * 1024

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function serviceError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requireOpenId(openId) {
  const value = String(openId || '').trim()
  if (!value) throw serviceError('UNAUTHENTICATED', '无法识别微信用户')
  return value
}

function requireRequest(input) {
  const expectedRevision = Number(input && input.expectedRevision)
  const requestId = String(input && input.requestId || '').trim()
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw serviceError('INVALID_REQUEST', '无效的数据版本')
  if (!requestId || requestId.length > 128) throw serviceError('INVALID_REQUEST', '无效的请求编号')
  return { expectedRevision, requestId }
}

function requireState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw serviceError('INVALID_STATE', '酒单数据格式无效')
  for (const key of ['recipes', 'materials', 'glassware', 'tools']) {
    if (!Array.isArray(value[key])) throw serviceError('INVALID_STATE', '酒单数据不完整')
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_SNAPSHOT_BYTES) throw serviceError('STATE_TOO_LARGE', '数据量过大，请先导出备份并联系支持')
  return clone(value)
}

function requireProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw serviceError('INVALID_PROFILE', '用户资料格式无效')
  if (!String(value.id || '').trim() || !String(value.nickname || '').trim()) throw serviceError('INVALID_PROFILE', '用户资料不完整')
  return clone(value)
}

function revisionOf(doc) {
  const revision = Number(doc && doc.revision)
  return Number.isInteger(revision) && revision >= 0 ? revision : 0
}

function emptyState() {
  return { recipes: [], materials: [], glassware: [], tools: [] }
}

function collectionForEntityType(entityType) {
  const pair = ENTITY_COLLECTIONS.find(([type]) => type === entityType)
  return pair && pair[1]
}

function requireChanges(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw serviceError('INVALID_CHANGES', '数据变更格式无效')
  const normalized = {}
  let itemCount = 0
  for (const [, collection] of ENTITY_COLLECTIONS) {
    const source = value[collection] || {}
    const upserts = Array.isArray(source.upserts) ? source.upserts.map(clone) : []
    const deletes = Array.isArray(source.deletes) ? source.deletes.map((id) => String(id || '').trim()) : []
    if (upserts.some((item) => !item || typeof item !== 'object' || !String(item.id || '').trim()) || deletes.some((id) => !id)) {
      throw serviceError('INVALID_CHANGES', '数据变更内容无效')
    }
    const upsertIds = new Set(upserts.map((item) => String(item.id)))
    const deleteIds = new Set(deletes)
    if (upsertIds.size !== upserts.length || deleteIds.size !== deletes.length || [...upsertIds].some((id) => deleteIds.has(id))) {
      throw serviceError('INVALID_CHANGES', '数据变更存在重复项')
    }
    itemCount += upserts.length + deletes.length
    normalized[collection] = { upserts, deletes }
  }
  if (itemCount > 200) throw serviceError('TOO_MANY_CHANGES', '单次修改内容过多，请分次保存')
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw serviceError('CHANGES_TOO_LARGE', '单次修改数据量过大，请分次保存')
  }
  return normalized
}

function changesFromOverlays(overlays, resetAt = '', resetRevision = 0) {
  const changes = Object.fromEntries(ENTITY_COLLECTIONS.map(([, collection]) => [collection, { upserts: [], deletes: [] }]))
  for (const overlay of Array.isArray(overlays) ? overlays : []) {
    const overlayRevision = Number(overlay && overlay.revision)
    if (resetRevision && Number.isInteger(overlayRevision) && overlayRevision <= resetRevision) continue
    if (resetAt && !Number.isInteger(overlayRevision) && (!overlay.updatedAt || overlay.updatedAt <= resetAt)) continue
    const collection = collectionForEntityType(overlay && overlay.entityType)
    const entityId = String(overlay && overlay.entityId || '').trim()
    if (!collection || !entityId) continue
    if (overlay.deleted) changes[collection].deletes.push(entityId)
    else if (overlay.value && String(overlay.value.id || '') === entityId) changes[collection].upserts.push(clone(overlay.value))
  }
  return changes
}

function previousEntitiesFor(state, changes) {
  const previous = []
  for (const [entityType, collection] of ENTITY_COLLECTIONS) {
    const byId = new Map((state[collection] || []).filter((item) => item && item.id).map((item) => [item.id, item]))
    for (const item of changes[collection].upserts) {
      previous.push({ entityType, entityId: item.id, item: clone(byId.get(item.id) || null) })
    }
    for (const entityId of changes[collection].deletes) {
      previous.push({ entityType, entityId, item: clone(byId.get(entityId) || null) })
    }
  }
  return previous
}

async function persistChanges(transaction, ownerOpenId, changes, updatedAt, requestId, revision) {
  for (const [entityType, collection] of ENTITY_COLLECTIONS) {
    for (const item of changes[collection].upserts) {
      await transaction.setEntityChange(ownerOpenId, entityType, item.id, {
        value: clone(item), deleted: false, updatedAt, requestId, revision
      })
    }
    for (const entityId of changes[collection].deletes) {
      await transaction.setEntityChange(ownerOpenId, entityType, entityId, {
        value: null, deleted: true, updatedAt, requestId, revision
      })
    }
  }
}

async function resolvedPreviousEntities(transaction, current, ownerOpenId, changes) {
  const baseline = current && current.state || emptyState()
  const previous = []
  for (const [entityType, collection] of ENTITY_COLLECTIONS) {
    const baselineById = new Map((baseline[collection] || []).filter((item) => item && item.id).map((item) => [item.id, item]))
    const changedIds = [
      ...changes[collection].upserts.map((item) => item.id),
      ...changes[collection].deletes
    ]
    for (const entityId of changedIds) {
      const overlay = typeof transaction.getEntityChange === 'function'
        ? await transaction.getEntityChange(ownerOpenId, entityType, entityId)
        : null
      const resetRevision = Number(current && current.entityResetRevision)
      const overlayRevision = Number(overlay && overlay.revision)
      const overlayIsCurrent = overlay && (
        Number.isInteger(overlayRevision)
          ? (!Number.isInteger(resetRevision) || overlayRevision > resetRevision)
          : (!current.entityResetAt || (overlay.updatedAt && overlay.updatedAt > current.entityResetAt))
      )
      const item = overlayIsCurrent ? (overlay.deleted ? null : overlay.value) : (baselineById.get(entityId) || null)
      previous.push({ entityType, entityId, item: clone(item) })
    }
  }
  return previous
}

function publicTrash(entry) {
  if (!entry) return null
  const { ownerOpenId, requestId, restoreRequestId, ...safe } = clone(entry)
  safe.id = safe.id || safe._id
  delete safe._id
  return safe
}

function createUserDataService({ store, now = () => new Date().toISOString() } = {}) {
  if (!store || typeof store.transaction !== 'function') throw new Error('Cloud data store unavailable')

  async function load(openId) {
    const ownerOpenId = requireOpenId(openId)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await store.getUser(ownerOpenId)
      if (!before) return { state: null, profile: null, revision: 0 }
      const overlays = typeof store.listEntityChanges === 'function' ? await store.listEntityChanges(ownerOpenId) : []
      const after = await store.getUser(ownerOpenId)
      if (revisionOf(before) !== revisionOf(after)) continue
      const state = before.state
        ? applyStateChanges(before.state, changesFromOverlays(overlays, before.entityResetAt, revisionOf({ revision: before.entityResetRevision })))
        : null
      return {
        state: clone(state),
        profile: clone(before.profile || null),
        revision: revisionOf(before)
      }
    }
    throw serviceError('LOAD_CONFLICT', '数据正在其他位置更新，请稍后重试')
  }

  async function saveChanges(openId, input) {
    const ownerOpenId = requireOpenId(openId)
    const changes = requireChanges(input && input.changes)
    const { expectedRevision, requestId } = requireRequest(input)
    return store.transaction(async (transaction) => {
      const current = await transaction.getUser(ownerOpenId)
      const currentRevision = revisionOf(current)
      if (current && current.lastRequestId === requestId) return { revision: currentRevision }
      if (currentRevision !== expectedRevision) throw serviceError('REVISION_CONFLICT', '数据已在其他位置更新，请重新进入后再试')

      const updatedAt = now()
      const nextRevision = currentRevision + 1
      const previousEntities = await resolvedPreviousEntities(transaction, current, ownerOpenId, changes)
      if (current && previousEntities.length) {
        await transaction.addHistory({
          ownerOpenId,
          kind: 'changes',
          previousEntities,
          revision: currentRevision,
          createdAt: updatedAt,
          expiresAt: new Date(new Date(updatedAt).getTime() + HISTORY_RETENTION_MS).toISOString(),
          requestId
        })
      }
      const previousByKey = new Map(previousEntities.map((entry) => [`${entry.entityType}:${entry.entityId}`, entry.item]))
      for (const [entityType, collection] of ENTITY_COLLECTIONS) {
        for (const entityId of changes[collection].deletes) {
          const item = previousByKey.get(`${entityType}:${entityId}`)
          if (!item) continue
          await transaction.addTrash({
            ownerOpenId,
            entityType,
            item: clone(item),
            deletedAt: updatedAt,
            expiresAt: new Date(new Date(updatedAt).getTime() + TRASH_RETENTION_MS).toISOString(),
            requestId
          })
        }
      }
      await persistChanges(transaction, ownerOpenId, changes, updatedAt, requestId, nextRevision)
      await transaction.setUser(ownerOpenId, {
        ...(current || {}),
        ownerOpenId,
        state: current && current.state ? current.state : emptyState(),
        storageVersion: 2,
        revision: nextRevision,
        lastRequestId: requestId,
        updatedAt
      })
      return { revision: nextRevision }
    })
  }

  async function saveState(openId, input) {
    const ownerOpenId = requireOpenId(openId)
    const state = requireState(input && input.state)
    const { expectedRevision, requestId } = requireRequest(input)
    const loaded = await load(ownerOpenId)
    return store.transaction(async (transaction) => {
      const current = await transaction.getUser(ownerOpenId)
      const currentRevision = revisionOf(current)
      if (current && current.lastRequestId === requestId) return { revision: currentRevision }
      if (currentRevision !== expectedRevision) throw serviceError('REVISION_CONFLICT', '数据已在其他位置更新，请重新进入后再试')

      const updatedAt = now()
      const nextRevision = currentRevision + 1
      if (current && loaded.state) {
        await transaction.addHistory({
          ownerOpenId,
          kind: 'state',
          previousState: clone(loaded.state),
          revision: currentRevision,
          createdAt: updatedAt,
          expiresAt: new Date(new Date(updatedAt).getTime() + HISTORY_RETENTION_MS).toISOString(),
          requestId
        })
        const deletedItems = diffDeletedItems(loaded.state, state, updatedAt, requestId)
        for (const item of deletedItems) await transaction.addTrash({ ownerOpenId, ...item })
      }
      await transaction.setUser(ownerOpenId, {
        ...(current || {}),
        ownerOpenId,
        state,
        entityResetAt: updatedAt,
        entityResetRevision: nextRevision,
        storageVersion: current && current.storageVersion || 1,
        revision: nextRevision,
        lastRequestId: requestId,
        updatedAt
      })
      return { revision: nextRevision }
    })
  }

  async function saveProfile(openId, input) {
    const ownerOpenId = requireOpenId(openId)
    const profile = requireProfile(input && input.profile)
    const { expectedRevision, requestId } = requireRequest(input)
    return store.transaction(async (transaction) => {
      const current = await transaction.getUser(ownerOpenId)
      const currentRevision = revisionOf(current)
      if (current && current.lastRequestId === requestId) return { revision: currentRevision }
      if (currentRevision !== expectedRevision) throw serviceError('REVISION_CONFLICT', '数据已在其他位置更新，请重新进入后再试')

      const updatedAt = now()
      const nextRevision = currentRevision + 1
      if (current && current.profile) {
        await transaction.addHistory({
          ownerOpenId,
          kind: 'profile',
          previousProfile: clone(current.profile),
          revision: currentRevision,
          createdAt: updatedAt,
          expiresAt: new Date(new Date(updatedAt).getTime() + HISTORY_RETENTION_MS).toISOString(),
          requestId
        })
      }
      await transaction.setUser(ownerOpenId, {
        ...(current || {}),
        ownerOpenId,
        profile,
        revision: nextRevision,
        lastRequestId: requestId,
        updatedAt
      })
      return { revision: nextRevision }
    })
  }

  async function listTrash(openId) {
    const ownerOpenId = requireOpenId(openId)
    const entries = await store.listTrash(ownerOpenId, now())
    return (Array.isArray(entries) ? entries : []).map(publicTrash).filter(Boolean)
  }

  async function restoreTrash(openId, input) {
    const ownerOpenId = requireOpenId(openId)
    const trashId = String(input && input.trashId || '').trim()
    const { expectedRevision, requestId } = requireRequest(input)
    if (!trashId) throw serviceError('INVALID_REQUEST', '请选择需要恢复的记录')
    const loaded = await load(ownerOpenId)
    return store.transaction(async (transaction) => {
      const current = await transaction.getUser(ownerOpenId)
      const currentRevision = revisionOf(current)
      if (current && current.lastRequestId === requestId) {
        return { state: clone(loaded.state), revision: currentRevision }
      }
      if (currentRevision !== expectedRevision) throw serviceError('REVISION_CONFLICT', '数据已更新，请重新进入回收站')
      const entry = await transaction.getTrash(trashId)
      if (!entry || entry.ownerOpenId !== ownerOpenId || entry.restoredAt || entry.expiresAt <= now()) {
        throw serviceError('TRASH_NOT_FOUND', '这条记录已经无法恢复')
      }
      const baseState = loaded.state
      if (!baseState) throw serviceError('INVALID_STATE', '当前数据无法恢复')
      let restoredState
      try {
        restoredState = restoreTrashItem(baseState, entry)
      } catch (error) {
        throw serviceError('RESTORE_CONFLICT', error.message || '恢复失败')
      }
      const restoredAt = now()
      const nextRevision = currentRevision + 1
      const changes = diffStateChanges(baseState, restoredState)
      await transaction.addHistory({
        ownerOpenId,
        kind: 'restore',
        previousEntities: previousEntitiesFor(baseState, changes),
        revision: currentRevision,
        createdAt: restoredAt,
        expiresAt: new Date(new Date(restoredAt).getTime() + HISTORY_RETENTION_MS).toISOString(),
        requestId
      })
      await persistChanges(transaction, ownerOpenId, changes, restoredAt, requestId, nextRevision)
      await transaction.setUser(ownerOpenId, {
        ...current,
        storageVersion: 2,
        revision: nextRevision,
        lastRequestId: requestId,
        updatedAt: restoredAt
      })
      await transaction.markTrashRestored(trashId, restoredAt)
      return { state: clone(restoredState), revision: nextRevision }
    })
  }

  function cleanupExpired() {
    return store.deleteExpired(now())
  }

  return { load, saveState, saveChanges, saveProfile, listTrash, restoreTrash, cleanupExpired }
}

module.exports = { MAX_SNAPSHOT_BYTES, createUserDataService, serviceError }
