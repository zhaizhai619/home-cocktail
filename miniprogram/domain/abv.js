const TOP_UP_VOLUME = 100
const NO_LIQUID_REASON = '没有可计算的液体材料'

function calculateAbv(ingredients) {
  let alcoholVolume = 0
  let liquidVolume = 0
  const missing = []
  const ignored = []

  for (const ingredient of Array.isArray(ingredients) ? ingredients : []) {
    const name = ingredient.name || '未命名材料'

    if (ingredient.unit === 'top-up') {
      if (ingredient.alcoholic) {
        missing.push(name)
      } else {
        liquidVolume += TOP_UP_VOLUME
      }
      continue
    }

    if (ingredient.unit !== 'ml') {
      if (ingredient.alcoholic) {
        missing.push(name)
      } else {
        ignored.push(name)
      }
      continue
    }

    const validAmount = Number.isFinite(ingredient.amount) && ingredient.amount >= 0
    if (!validAmount) {
      if (ingredient.alcoholic) {
        missing.push(name)
      } else {
        ignored.push(name)
      }
      continue
    }

    liquidVolume += ingredient.amount

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

  if (liquidVolume === 0) {
    missing.push(NO_LIQUID_REASON)
  }

  if (missing.length > 0) {
    return { status: 'missing', abv: null, liquidVolume, missing, ignored }
  }

  return {
    status: 'ok',
    abv: Math.round((alcoholVolume / liquidVolume) * 10) / 10,
    liquidVolume,
    missing: [],
    ignored
  }
}

module.exports = { calculateAbv }
