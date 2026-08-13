const STATE_COLLECTIONS = ['recipes', 'materials', 'glassware', 'tools']

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function diffStateChanges(previousState, nextState) {
  const previous = previousState && typeof previousState === 'object' ? previousState : {}
  const next = nextState && typeof nextState === 'object' ? nextState : {}
  const changes = {}
  for (const collection of STATE_COLLECTIONS) {
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

module.exports = { STATE_COLLECTIONS, diffStateChanges }
