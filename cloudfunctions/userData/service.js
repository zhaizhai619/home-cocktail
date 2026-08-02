const { HISTORY_RETENTION_MS, diffDeletedItems, restoreTrashItem } = require('./domain')

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
    const doc = await store.getUser(ownerOpenId)
    if (!doc) return { state: null, profile: null, revision: 0 }
    return {
      state: clone(doc.state || null),
      profile: clone(doc.profile || null),
      revision: revisionOf(doc)
    }
  }

  async function saveState(openId, input) {
    const ownerOpenId = requireOpenId(openId)
    const state = requireState(input && input.state)
    const { expectedRevision, requestId } = requireRequest(input)
    return store.transaction(async (transaction) => {
      const current = await transaction.getUser(ownerOpenId)
      const currentRevision = revisionOf(current)
      if (current && current.lastRequestId === requestId) return { revision: currentRevision }
      if (currentRevision !== expectedRevision) throw serviceError('REVISION_CONFLICT', '数据已在其他位置更新，请重新进入后再试')

      const updatedAt = now()
      const nextRevision = currentRevision + 1
      if (current && current.state) {
        await transaction.addHistory({
          ownerOpenId,
          kind: 'state',
          previousState: clone(current.state),
          revision: currentRevision,
          createdAt: updatedAt,
          expiresAt: new Date(new Date(updatedAt).getTime() + HISTORY_RETENTION_MS).toISOString(),
          requestId
        })
        const deletedItems = diffDeletedItems(current.state, state, updatedAt, requestId)
        for (const item of deletedItems) await transaction.addTrash({ ownerOpenId, ...item })
      }

      await transaction.setUser(ownerOpenId, {
        ...(current || {}),
        ownerOpenId,
        state,
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
    return store.transaction(async (transaction) => {
      const current = await transaction.getUser(ownerOpenId)
      const currentRevision = revisionOf(current)
      if (current && current.lastRequestId === requestId) {
        return { state: clone(current.state), revision: currentRevision }
      }
      if (currentRevision !== expectedRevision) throw serviceError('REVISION_CONFLICT', '数据已更新，请重新进入回收站')
      const entry = await transaction.getTrash(trashId)
      if (!entry || entry.ownerOpenId !== ownerOpenId || entry.restoredAt || entry.expiresAt <= now()) {
        throw serviceError('TRASH_NOT_FOUND', '这条记录已经无法恢复')
      }
      const baseState = current && current.state
      if (!baseState) throw serviceError('INVALID_STATE', '当前数据无法恢复')
      let restoredState
      try {
        restoredState = restoreTrashItem(baseState, entry)
      } catch (error) {
        throw serviceError('RESTORE_CONFLICT', error.message || '恢复失败')
      }
      const restoredAt = now()
      const nextRevision = currentRevision + 1
      await transaction.addHistory({
        ownerOpenId,
        kind: 'restore',
        previousState: clone(baseState),
        revision: currentRevision,
        createdAt: restoredAt,
        expiresAt: new Date(new Date(restoredAt).getTime() + HISTORY_RETENTION_MS).toISOString(),
        requestId
      })
      await transaction.setUser(ownerOpenId, {
        ...current,
        state: restoredState,
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

  return { load, saveState, saveProfile, listTrash, restoreTrash, cleanupExpired }
}

module.exports = { MAX_SNAPSHOT_BYTES, createUserDataService, serviceError }
