const { TOP_UP_VOLUME, analyzeLiquidVolume } = require('./abv')

function compactNumber(value) {
  return Math.round(Number(value) * 10) / 10
}

function liquidVolumeSummary(ingredients) {
  const analysis = analyzeLiquidVolume(ingredients)
  return { complete: analysis.missing.length === 0, liquidVolume: compactNumber(analysis.liquidVolume), missing: analysis.missing, ignored: analysis.ignored }
}

function calculateGlassCapacity(ingredients, glassware) {
  const volume = liquidVolumeSummary(ingredients)
  const source = glassware && typeof glassware === 'object' ? glassware : null
  const capacity = source && Number(source.capacityMl !== undefined ? source.capacityMl : source.capacity)
  const hasGlass = Boolean(source && Number.isFinite(capacity) && capacity > 0)
  if (!volume.complete) {
    const known = volume.liquidVolume > 0 ? `（已知液体至少 ${volume.liquidVolume}ml）` : ''
    return { status: 'incomplete', liquidVolume: volume.liquidVolume, capacityMl: hasGlass ? capacity : null, differenceMl: null, message: `总体积信息不完整${known}`, ignored: volume.ignored }
  }
  if (source && !hasGlass) {
    return { status: 'invalid-glass', liquidVolume: volume.liquidVolume, capacityMl: null, differenceMl: null, message: '杯具容量资料缺失，请先到“我的”中补充', ignored: volume.ignored }
  }
  if (!hasGlass) {
    return { status: 'no-glass', liquidVolume: volume.liquidVolume, capacityMl: null, differenceMl: null, message: `预计液体体积 ${volume.liquidVolume}ml / 未选择杯具`, ignored: volume.ignored }
  }
  const signedDifference = compactNumber(capacity - volume.liquidVolume)
  if (signedDifference < 0) {
    const differenceMl = Math.abs(signedDifference)
    return { status: 'over', liquidVolume: volume.liquidVolume, capacityMl: capacity, differenceMl, message: `预计液体体积 ${volume.liquidVolume}ml / 杯具 ${capacity}ml / 预计超出 ${differenceMl}ml`, ignored: volume.ignored }
  }
  if (signedDifference === 0) {
    return { status: 'exact', liquidVolume: volume.liquidVolume, capacityMl: capacity, differenceMl: 0, message: `预计液体体积 ${volume.liquidVolume}ml / 杯具 ${capacity}ml / 容量刚好`, ignored: volume.ignored }
  }
  return { status: 'under', liquidVolume: volume.liquidVolume, capacityMl: capacity, differenceMl: signedDifference, message: `预计液体体积 ${volume.liquidVolume}ml / 杯具 ${capacity}ml / 约剩 ${signedDifference}ml`, ignored: volume.ignored }
}

module.exports = { TOP_UP_VOLUME, calculateGlassCapacity, liquidVolumeSummary }
