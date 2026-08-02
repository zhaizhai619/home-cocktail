const TOP_UP_VOLUME = 100
const NO_LIQUID_REASON = '没有可计算的液体材料'

function classifyLiquidIngredient(ingredient) {
  if (ingredient.unit === 'top-up') return ingredient.alcoholic ? { kind: 'missing', volume: 0 } : { kind: 'volume', volume: TOP_UP_VOLUME }
  if (ingredient.unit !== 'ml') return ingredient.alcoholic ? { kind: 'missing', volume: 0 } : { kind: 'ignored', volume: 0 }
  return Number.isFinite(ingredient.amount) && ingredient.amount >= 0 ? { kind: 'volume', volume: ingredient.amount } : { kind: 'missing', volume: 0 }
}

function analyzeLiquidVolume(ingredients) {
  let liquidVolume = 0
  const missing = []
  const ignored = []

  for (const ingredient of Array.isArray(ingredients) ? ingredients : []) {
    if (!ingredient || typeof ingredient !== 'object') {
      continue
    }

    const name = ingredient.name || '未命名材料'

    const classification = classifyLiquidIngredient(ingredient)
    liquidVolume += classification.volume
    if (classification.kind === 'missing') missing.push(name)
    if (classification.kind === 'ignored') ignored.push(name)
  }

  return { liquidVolume, missing, ignored }
}

function calculateAbv(ingredients) {
  const rows = Array.isArray(ingredients) ? ingredients : []
  const volume = analyzeLiquidVolume(rows)
  let alcoholVolume = 0
  const missing = []

  for (const ingredient of rows) {
    if (!ingredient || typeof ingredient !== 'object') continue
    const name = ingredient.name || '未命名材料'
    const classification = classifyLiquidIngredient(ingredient)
    if (classification.kind === 'missing') { missing.push(name); continue }
    if (ingredient.unit !== 'ml') continue

    if (ingredient.alcoholic) {
      const validAbv = Number.isFinite(ingredient.abv) &&
        ingredient.abv >= 0 && ingredient.abv <= 100

      if (!validAbv) {
        missing.push(name)
      } else {
        alcoholVolume += ingredient.amount * ingredient.abv
      }
    }
  }

  if (volume.liquidVolume === 0) {
    missing.push(NO_LIQUID_REASON)
  }

  if (missing.length > 0) {
    return { status: 'missing', abv: null, liquidVolume: volume.liquidVolume, missing, ignored: volume.ignored }
  }

  return {
    status: 'ok',
    abv: Math.round((alcoholVolume / volume.liquidVolume) * 10) / 10,
    liquidVolume: volume.liquidVolume,
    missing: [],
    ignored: volume.ignored
  }
}

function recipeIngredientsForAbv(recipe, materialsById) {
  const source = recipe && typeof recipe === 'object' ? recipe : {}
  const lookup = materialsById && typeof materialsById === 'object' ? materialsById : {}
  return (Array.isArray(source.ingredients) ? source.ingredients : []).map((ingredient) => {
    if (!ingredient || typeof ingredient !== 'object') return null
    const material = Object.prototype.hasOwnProperty.call(lookup, ingredient.materialId) && lookup[ingredient.materialId] && typeof lookup[ingredient.materialId] === 'object'
      ? lookup[ingredient.materialId]
      : null
    const rawAmount = ingredient.amount
    const numericAmount = rawAmount === null || rawAmount === undefined || String(rawAmount).trim() === '' ? rawAmount : Number(rawAmount)
    const amount = Number.isFinite(numericAmount) ? numericAmount : rawAmount
    if (!material) return { name: `缺失材料（${ingredient.materialId || '未知'}）`, amount, unit: ingredient.unit, alcoholic: true, abv: null, form: ingredient.unit === 'ml' ? 'liquid' : undefined }
    const numericAbv = Number(material.abv)
    const hasAbv = material.abv !== null && material.abv !== undefined && String(material.abv).trim() !== '' && Number.isFinite(numericAbv) && numericAbv > 0 && numericAbv <= 100
    return { name: material.name || '未命名材料', amount, unit: ingredient.unit, alcoholic: material.alcoholic === true, abv: hasAbv ? numericAbv : null, form: material.form, category: material.category }
  })
}

module.exports = { TOP_UP_VOLUME, analyzeLiquidVolume, calculateAbv, recipeIngredientsForAbv }
