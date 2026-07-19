const MAX_GLASS_CAPACITY_ML = 5000
const DEFAULT_GLASS_CAPACITY_ML = 300

function normalizeEquipmentName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function equipmentNameIdentity(value) {
  return normalizeEquipmentName(value).toLocaleLowerCase('zh-CN')
}

function normalizeGlassCapacity(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_GLASS_CAPACITY_ML
  return Math.min(numeric, MAX_GLASS_CAPACITY_ML)
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
  DEFAULT_GLASS_CAPACITY_ML,
  normalizeEquipmentName,
  equipmentNameIdentity,
  normalizeGlassCapacity,
  makeUniqueEquipmentName
}
