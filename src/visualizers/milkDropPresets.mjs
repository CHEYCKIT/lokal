const TOO_HEAVY = /mandelbox|reaction diffusion/i
const EXCLUDED_PRESETS = new Set(['idiot - star of annon'])

const normalizePresetName = name => name
  .trim()
  .toLowerCase()
  .replace(/\s*-\s*/g, ' - ')
  .replace(/\s+/g, ' ')

export function filterMilkDropPresetNames(names) {
  return names.filter(name =>
    !TOO_HEAVY.test(name) && !EXCLUDED_PRESETS.has(normalizePresetName(name)),
  )
}

const unwrap = (mod, key) => [mod, mod?.default, mod?.default?.default]
  .find(value => value && typeof value[key] === 'function')

let presetsPromise = null

/** Load the lightweight Butterchurn preset pack only when the user needs it. */
export function loadMilkDropPresets() {
  if (!presetsPromise) {
    presetsPromise = import('butterchurn-presets/lib/butterchurnPresetsMinimal.min.js')
      .then(module => {
        const pack = unwrap(module, 'getPresets')
        if (!pack) throw new Error('MilkDrop preset pack did not load')
        const all = pack.getPresets()
        return filterMilkDropPresetNames(Object.keys(all))
          .map(name => ({ name, preset: all[name] }))
      })
      .catch(error => {
        presetsPromise = null
        throw error
      })
  }
  return presetsPromise
}

export async function loadMilkDropPresetNames() {
  return (await loadMilkDropPresets()).map(({ name }) => name)
}

/**
 * Normalize the saved preset allowlist against the presets available in this
 * version of Butterchurn. Missing, malformed, empty, and fully stale settings
 * all fall back to the complete current list.
 */
export function normalizeEnabledMilkDropPresets(value, availablePresetNames = []) {
  const available = Array.isArray(availablePresetNames)
    ? [...new Set(availablePresetNames.filter(name => typeof name === 'string'))]
    : []
  let parsed = value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { parsed = null }
  }
  if (!Array.isArray(parsed)) return [...available]
  const valid = new Set(available)
  const selected = [...new Set(parsed.filter(name => typeof name === 'string' && valid.has(name)))]
  return selected.length ? selected : [...available]
}
