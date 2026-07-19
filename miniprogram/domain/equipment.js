const TOP_UP_VOLUME = 100
const LIQUID_CATEGORIES = new Set([
  'base-spirit', 'other-base-spirit', 'liqueur', 'bitters', 'citrus',
  'syrup/staple', 'soda/tonic', 'other-liquid', 'dairy/juice'
])

function compactNumber(value) {
  return Math.round(Number(value) * 10) / 10
}

function isLiquidIngredient(ingredient) {
  if (!ingredient || typeof ingredient !== 'object') return false
  return ingredient.form === 'liquid' || ingredient.alcoholic === true || LIQUID_CATEGORIES.has(ingredient.category)
}

function liquidVolumeSummary(ingredients) {
  let liquidVolume = 0
  let complete = true
  for (const ingredient of Array.isArray(ingredients) ? ingredients : []) {
    if (!ingredient || typeof ingredient !== 'object') continue
    if (ingredient.unit === 'top-up') {
      liquidVolume += TOP_UP_VOLUME
      continue
    }
    if (ingredient.unit === 'ml') {
      const amount = Number(ingredient.amount)
      if (!Number.isFinite(amount) || amount < 0 || ingredient.amount === '' || ingredient.amount === null || ingredient.amount === undefined) complete = false
      else liquidVolume += amount
      continue
    }
    if (isLiquidIngredient(ingredient)) complete = false
  }
  return { complete, liquidVolume: compactNumber(liquidVolume) }
}

function calculateGlassCapacity(ingredients, glassware) {
  const volume = liquidVolumeSummary(ingredients)
  const source = glassware && typeof glassware === 'object' ? glassware : null
  const capacity = source && Number(source.capacityMl !== undefined ? source.capacityMl : source.capacity)
  const hasGlass = Boolean(source && Number.isFinite(capacity) && capacity > 0)
  if (!volume.complete) {
    return { status: 'incomplete', liquidVolume: volume.liquidVolume, capacityMl: hasGlass ? capacity : null, differenceMl: null, message: '总体积信息不完整' }
  }
  if (source && !hasGlass) {
    return { status: 'invalid-glass', liquidVolume: volume.liquidVolume, capacityMl: null, differenceMl: null, message: '杯具容量资料缺失，请先到“我的”中补充' }
  }
  if (!hasGlass) {
    return { status: 'no-glass', liquidVolume: volume.liquidVolume, capacityMl: null, differenceMl: null, message: `预计液体体积 ${volume.liquidVolume}ml / 未选择杯具` }
  }
  const signedDifference = compactNumber(capacity - volume.liquidVolume)
  if (signedDifference < 0) {
    const differenceMl = Math.abs(signedDifference)
    return { status: 'over', liquidVolume: volume.liquidVolume, capacityMl: capacity, differenceMl, message: `预计液体体积 ${volume.liquidVolume}ml / 杯具 ${capacity}ml / 预计超出 ${differenceMl}ml` }
  }
  if (signedDifference === 0) {
    return { status: 'exact', liquidVolume: volume.liquidVolume, capacityMl: capacity, differenceMl: 0, message: `预计液体体积 ${volume.liquidVolume}ml / 杯具 ${capacity}ml / 容量刚好` }
  }
  return { status: 'under', liquidVolume: volume.liquidVolume, capacityMl: capacity, differenceMl: signedDifference, message: `预计液体体积 ${volume.liquidVolume}ml / 杯具 ${capacity}ml / 约剩 ${signedDifference}ml` }
}

module.exports = { TOP_UP_VOLUME, calculateGlassCapacity, liquidVolumeSummary }
