const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/

function hasValidDateParts(match) {
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const checked = new Date(Date.UTC(year, month - 1, day))
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) return false
  if (match[4] !== undefined && Number(match[4]) > 23) return false
  if (match[5] !== undefined && Number(match[5]) > 59) return false
  if (match[6] !== undefined && Number(match[6]) > 59) return false
  if (match[7] !== undefined && Number(match[7]) > 23) return false
  if (match[8] !== undefined && Number(match[8]) > 59) return false
  return true
}

function isValidDateString(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  const match = DATE_PATTERN.exec(value)
  return Boolean(match && hasValidDateParts(match) && Number.isFinite(Date.parse(value)))
}

function toLocalDateValue(value) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return isValidDateString(value) ? value : ''
  if (typeof value === 'string' && !isValidDateString(value)) return ''
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

module.exports = { isValidDateString, toLocalDateValue }
