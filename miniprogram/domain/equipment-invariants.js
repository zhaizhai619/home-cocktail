const MAX_GLASS_CAPACITY_ML = 5000

function normalizeEquipmentName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function equipmentNameIdentity(value) {
  return normalizeEquipmentName(value).toLocaleLowerCase('zh-CN')
}

function normalizeGlassCapacity(value) {
  const numeric = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(numeric) || numeric <= 0 || numeric > MAX_GLASS_CAPACITY_ML) return null
  return numeric
}

function isValidGlassCapacity(value) {
  return normalizeGlassCapacity(value) !== null
}

function makeUniqueEquipmentName(value, fallback, usedIdentities) {
  const used = usedIdentities || new Set()
  const base = normalizeEquipmentName(value) || fallback
  let candidate = base
  let suffix = 2
  while (used.has(equipmentNameIdentity(candidate))) candidate = `${base} (${suffix++})`
  used.add(equipmentNameIdentity(candidate))
  return candidate
}

module.exports = {
  MAX_GLASS_CAPACITY_ML,
  normalizeEquipmentName,
  equipmentNameIdentity,
  normalizeGlassCapacity,
  isValidGlassCapacity,
  makeUniqueEquipmentName
}
