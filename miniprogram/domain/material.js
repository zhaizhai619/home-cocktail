const CATEGORY_ALIASES = {
  tonic: 'soda/tonic',
  soda: 'soda/tonic',
  dairy: 'dairy/juice',
  juice: 'dairy/juice',
  syrup: 'syrup/staple',
  staple: 'syrup/staple'
}

const CATEGORY_DEFAULTS = {
  'base-spirit': {
    acquisition: 'long-term',
    form: 'liquid',
    alcoholic: true,
    abv: 40,
    unit: 'ml',
    trackFreshness: false,
    assumedAvailable: false,
    owned: true,
    freshOnHand: false
  },
  'other-base-spirit': {
    acquisition: 'long-term',
    form: 'liquid',
    alcoholic: true,
    abv: null,
    unit: 'ml',
    trackFreshness: false,
    assumedAvailable: false,
    owned: false,
    freshOnHand: false
  },
  liqueur: {
    acquisition: 'long-term',
    form: 'liquid',
    alcoholic: true,
    abv: null,
    unit: 'ml',
    trackFreshness: false,
    assumedAvailable: false,
    owned: false,
    freshOnHand: false
  },
  bitters: {
    acquisition: 'long-term',
    form: 'liquid',
    alcoholic: true,
    abv: null,
    unit: 'drop',
    trackFreshness: false,
    assumedAvailable: false,
    owned: false,
    freshOnHand: false
  },
  citrus: {
    acquisition: 'long-term',
    form: 'liquid',
    alcoholic: false,
    abv: null,
    unit: 'ml',
    trackFreshness: false,
    assumedAvailable: true,
    owned: true,
    freshOnHand: false
  },
  'syrup/staple': {
    acquisition: 'long-term',
    form: 'liquid',
    alcoholic: false,
    abv: null,
    unit: 'ml',
    trackFreshness: false,
    assumedAvailable: true,
    owned: true,
    freshOnHand: false
  },
  fruit: {
    acquisition: 'on-demand',
    form: 'solid',
    alcoholic: false,
    abv: null,
    unit: 'ml',
    trackFreshness: true,
    assumedAvailable: false,
    owned: false,
    freshOnHand: false
  },
  'dairy/juice': {
    acquisition: 'on-demand',
    form: 'liquid',
    alcoholic: false,
    abv: null,
    unit: 'ml',
    trackFreshness: true,
    assumedAvailable: false,
    owned: false,
    freshOnHand: false
  },
  'soda/tonic': {
    acquisition: 'on-demand',
    form: 'liquid',
    alcoholic: false,
    abv: null,
    unit: 'top-up',
    trackFreshness: false,
    assumedAvailable: false,
    owned: false,
    freshOnHand: false
  },
  'other-liquid': {
    acquisition: 'on-demand',
    form: 'liquid',
    alcoholic: false,
    abv: null,
    unit: 'ml',
    trackFreshness: false,
    assumedAvailable: false,
    owned: false,
    freshOnHand: false
  },
  'other-solid': {
    acquisition: 'on-demand',
    form: 'solid',
    alcoholic: false,
    abv: null,
    unit: 'g',
    trackFreshness: false,
    assumedAvailable: false,
    owned: false,
    freshOnHand: false
  }
}

function createMaterialDefaults(category, name) {
  const normalizedCategory = CATEGORY_ALIASES[category] || category
  const defaults = CATEGORY_DEFAULTS[normalizedCategory]

  if (!defaults) {
    throw new RangeError(`Unsupported material category: ${category}`)
  }

  return {
    category,
    name,
    ...defaults
  }
}

function getMaterialVisualState(material) {
  if (material.assumedAvailable && material.trackFreshness === false) {
    return 'owned'
  }

  if (material.acquisition === 'on-demand') {
    return material.freshOnHand ? 'owned' : 'quick-buy'
  }

  return material.owned ? 'owned' : 'missing-long-term'
}

module.exports = {
  createMaterialDefaults,
  getMaterialVisualState
}
