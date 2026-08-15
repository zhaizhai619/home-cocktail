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
    defaultUnit: 'ml',
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
    defaultUnit: 'ml',
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
    defaultUnit: 'ml',
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
    defaultUnit: 'drop',
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
    defaultUnit: 'ml',
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
    defaultUnit: 'ml',
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
    defaultUnit: 'ml',
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
    defaultUnit: 'ml',
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
    defaultUnit: 'top-up',
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
    defaultUnit: 'ml',
    trackFreshness: false,
    assumedAvailable: false,
    owned: false,
    freshOnHand: false
  },
  'other-solid': {
    acquisition: 'long-term',
    form: 'solid',
    alcoholic: false,
    abv: null,
    defaultUnit: 'g',
    trackFreshness: false,
    assumedAvailable: false,
    owned: false,
    freshOnHand: false
  },
  other: {
    acquisition: 'on-demand',
    form: 'liquid',
    alcoholic: false,
    abv: null,
    defaultUnit: 'ml',
    trackFreshness: false,
    assumedAvailable: false,
    owned: false,
    freshOnHand: false
  }
}

const MATERIAL_CATEGORY_GROUPS = Object.freeze([
  Object.freeze({ key: 'base', label: '基酒', category: 'base-spirit', categories: Object.freeze(['base-spirit', 'other-base-spirit']) }),
  Object.freeze({ key: 'liqueur', label: '利口酒', category: 'liqueur', categories: Object.freeze(['liqueur']) }),
  Object.freeze({ key: 'syrup', label: '糖浆', category: 'syrup/staple', categories: Object.freeze(['syrup/staple']) }),
  Object.freeze({ key: 'produce', label: '果汁/果蔬', category: 'fruit', categories: Object.freeze(['citrus', 'fruit', 'dairy/juice']) }),
  Object.freeze({ key: 'mixer', label: '混合饮品', category: 'other-liquid', categories: Object.freeze(['soda/tonic', 'other-liquid']) }),
  Object.freeze({ key: 'spice', label: '香料', category: 'other-solid', categories: Object.freeze(['bitters', 'other-solid']) }),
  Object.freeze({ key: 'other', label: '其他', category: 'other', categories: Object.freeze(['other']) })
])

function getMaterialCategoryGroup(category) {
  return MATERIAL_CATEGORY_GROUPS.find((group) => group.categories.includes(category)) || MATERIAL_CATEGORY_GROUPS[MATERIAL_CATEGORY_GROUPS.length - 1]
}

function selectMaterialCategory(currentCategory, groupKey) {
  const group = MATERIAL_CATEGORY_GROUPS.find((item) => item.key === groupKey) || getMaterialCategoryGroup('other')
  return group.categories.includes(currentCategory) ? currentCategory : group.category
}

function normalizeMaterialName(category, name) {
  const normalizedCategory = CATEGORY_ALIASES[category] || category
  const trimmedName = String(name || '').trim()
  if (normalizedCategory === 'base-spirit' && trimmedName === '朗姆') return '白朗姆'
  if (normalizedCategory === 'syrup/staple' && ['糖浆', '单糖浆'].includes(trimmedName)) return '普通糖浆'
  return trimmedName
}

function getMaterialDisplayName(category, name) {
  const normalizedCategory = CATEGORY_ALIASES[category] || category
  const normalizedName = normalizeMaterialName(normalizedCategory, name)
  return normalizedCategory === 'syrup/staple' && normalizedName === '普通糖浆'
    ? '糖浆'
    : normalizedName
}

function materialNameMatchesQuery(category, name, query) {
  const normalizedCategory = CATEGORY_ALIASES[category] || category
  const normalizedName = normalizeMaterialName(normalizedCategory, name)
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  const names = [normalizedName, getMaterialDisplayName(normalizedCategory, normalizedName)]
  if (normalizedCategory === 'syrup/staple' && normalizedName === '普通糖浆') names.push('单糖浆')
  return names.some((candidate) => String(candidate || '').toLocaleLowerCase().includes(normalizedQuery))
}

function normalizeMaterialObservations(value) {
  return (Array.isArray(value) ? value : []).reduce((observations, item) => {
    if (!item || typeof item !== 'object' || typeof item.note !== 'string' || !item.note.trim()) return observations
    const observation = { note: item.note.trim() }
    if (typeof item.createdAt === 'string' && item.createdAt) observation.createdAt = item.createdAt
    observations.push(observation)
    return observations
  }, [])
}

function createMaterialDefaults(category, name) {
  const normalizedCategory = CATEGORY_ALIASES[category] || category
  const defaults = CATEGORY_DEFAULTS[normalizedCategory]

  if (!defaults) {
    throw new RangeError(`Unsupported material category: ${category}`)
  }

  return {
    category: normalizedCategory,
    name: normalizeMaterialName(normalizedCategory, name),
    ...defaults
  }
}

function getMaterialIdentityKey(category, name) {
  let defaults
  try { defaults = createMaterialDefaults(category || 'other-liquid', String(name || '').trim()) } catch (_) { defaults = createMaterialDefaults('other-liquid', String(name || '').trim()) }
  return `${defaults.category}:${String(defaults.name || '').trim().toLowerCase()}`
}

function isMaterialAvailable(material) {
  if (!material || typeof material !== 'object') return false
  if (material.acquisition === 'on-demand') return material.freshOnHand === true
  if (material.acquisition === 'long-term') return material.owned === true
  return material.owned === true || material.freshOnHand === true
}

function materialAvailabilityFields(material, available) {
  return material && material.acquisition === 'on-demand'
    ? { owned: false, freshOnHand: available === true }
    : { owned: available === true, freshOnHand: false }
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
  MATERIAL_CATEGORY_GROUPS,
  createMaterialDefaults,
  getMaterialCategoryGroup,
  getMaterialDisplayName,
  getMaterialIdentityKey,
  getMaterialVisualState,
  isMaterialAvailable,
  materialAvailabilityFields,
  materialNameMatchesQuery,
  normalizeMaterialObservations,
  normalizeMaterialName,
  selectMaterialCategory
}
