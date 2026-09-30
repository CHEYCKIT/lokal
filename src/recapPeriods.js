// Listening recap periods: weeks (Monday to Sunday), months and years.
// A period only shows once it has ended. Shared by the Recap page and the
// sidebar's "new recap" badge; the backend (electron/ipc/recaps.js) turns
// { scope, weekStart | month, year, tz } into the same time range.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// How far back each kind of recap is offered.
const WEEKS_BACK = 12
const MONTHS_BACK = 12
const YEARS_BACK = 3

const pad = (n) => String(n).padStart(2, '0')

/** "2026-09-21" for a local date. */
export function isoDay(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local midnight of the Monday starting the week that contains `date`. */
export function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

function weekStartDate(period) {
  const [y, m, d] = String(period.weekStart).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** When a period ends (it can be shown from then on). */
export function periodEnd(period) {
  if (period.scope === 'year') return new Date(period.year + 1, 0, 1)
  if (period.scope === 'month') return new Date(period.year, period.month, 1) // month is 1-12
  if (period.scope === 'week') {
    const end = weekStartDate(period)
    end.setDate(end.getDate() + 7)
    return end
  }
  return new Date()
}

/** "Sep 21–27" or "Sep 29 – Oct 5" (the week's Monday to Sunday). */
function weekRangeText(period, withYear = false) {
  const start = weekStartDate(period)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const sameMonth = start.getMonth() === end.getMonth()
  const text = sameMonth
    ? `${SHORT_MONTHS[start.getMonth()]} ${start.getDate()}–${end.getDate()}`
    : `${SHORT_MONTHS[start.getMonth()]} ${start.getDate()} – ${SHORT_MONTHS[end.getMonth()]} ${end.getDate()}`
  return withYear ? `${text}, ${end.getFullYear()}` : text
}

/** "Week of Sep 21–27, 2026 Recap", "September 2026 Recap", "2026 Recap". */
export function periodTitle(period) {
  if (!period) return 'Recap'
  if (period.scope === 'week') return `Week of ${weekRangeText(period, true)} Recap`
  const soFar = period.partial ? ' So Far' : ''
  if (period.scope === 'month') return `${MONTHS[period.month - 1]} ${period.year}${soFar} Recap`
  return `${period.year}${soFar} Recap`
}

/**
 * A period as a playlist name puts it: "September 2026 - Week 3",
 * "September 2026", "2026". A week is numbered within the month its
 * Thursday is in (the month the Recap page lists it under), so the first
 * week of September is the one whose Thursday is between the 1st and 7th.
 */
export function periodPlaylistText(period) {
  if (!period) return ''
  if (period.scope === 'week') {
    const thursday = weekStartDate(period)
    thursday.setDate(thursday.getDate() + 3)
    return `${MONTHS[thursday.getMonth()]} ${thursday.getFullYear()} - Week ${Math.ceil(thursday.getDate() / 7)}`
  }
  const soFar = period.partial ? ' so far' : ''
  if (period.scope === 'month') return `${MONTHS[period.month - 1]} ${period.year}${soFar}`
  return `${period.year}${soFar}`
}

/** "J-Pop - September 2026 - Week 3": a playlist made from part of a recap. */
export function recapPlaylistName(subject, period) {
  const when = periodPlaylistText(period)
  return when ? `${subject} - ${when}` : subject
}

/** Short label for the period chips: "Sep 21–27", "Sep 2026", "Year 2026". */
export function periodLabel(period) {
  if (!period) return ''
  if (period.scope === 'week') return weekRangeText(period)
  if (period.scope === 'month') return `${SHORT_MONTHS[period.month - 1]} ${period.year}`
  return `Year ${period.year}`
}

function withText(period) {
  return { ...period, label: periodLabel(period), title: periodTitle(period), completedAt: periodEnd(period).getTime() }
}

/** Every finished period on offer, the most recently finished first (last week first). */
export function completedPeriods(now = new Date()) {
  const periods = []
  // Weeks: the last WEEKS_BACK full weeks (this week is still going).
  const thisMonday = mondayOf(now)
  for (let i = 1; i <= WEEKS_BACK; i += 1) {
    const start = new Date(thisMonday)
    start.setDate(start.getDate() - 7 * i)
    periods.push(withText({ id: `w-${isoDay(start)}`, scope: 'week', weekStart: isoDay(start), year: start.getFullYear() }))
  }
  // Months: the last MONTHS_BACK full months (this month is still going).
  for (let i = 1; i <= MONTHS_BACK; i += 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const month = start.getMonth() + 1
    periods.push(withText({ id: `m-${start.getFullYear()}-${pad(month)}`, scope: 'month', year: start.getFullYear(), month }))
  }
  const year = now.getFullYear()
  for (let y = year; y >= year - YEARS_BACK; y -= 1) {
    const yearly = { id: `year-${y}`, scope: 'year', year: y }
    if (periodEnd(yearly) <= now) periods.push(withText(yearly))
  }
  return periods.sort((left, right) => right.completedAt - left.completedAt)
}

/** The listener's time zone ("Europe/Paris"), so the server cuts weeks where they do. */
function localTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined } catch { return undefined }
}

/** When the next period finishes (the next Monday or 1st of the month), after `now`. */
export function nextPeriodBoundary(now = new Date()) {
  const monday = mondayOf(now)
  monday.setDate(monday.getDate() + 7)
  const month = new Date(now.getFullYear(), now.getMonth() + 1, 1) // also covers the new year
  return new Date(Math.min(monday.getTime(), month.getTime()))
}

/** What the backend needs to build a period's recap. */
export function periodQuery(period, extra = {}) {
  if (period.scope === 'week') return { scope: 'week', weekStart: period.weekStart, tz: localTimeZone(), ...extra }
  const partial = period.partial ? { partial: 1 } : {}
  if (period.scope === 'month') return { scope: 'month', year: period.year, month: period.month, tz: localTimeZone(), ...partial, ...extra }
  return { scope: 'year', year: period.year, tz: localTimeZone(), ...partial, ...extra }
}

// ---------------------------------------------------------------- navigation
//
// The Recap page lets you pick a year, then a month in it, then a week in
// that month, and only offers periods that have plays. It's built from the
// days with plays (from the backend, in the listener's time zone). A week
// belongs to the month (and year) its Thursday is in, like ISO weeks, so a
// week is listed once, under the month holding most of its days.

function parseDay(day) {
  const [y, m, d] = String(day).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * [{ year, period (the whole year, or null while it's going), months: [
 *    { year, month, key, period (or null while it's going), weeks: [period] }
 * ] }], newest year first (soFar: a month or year still going, up to now), months and weeks in calendar order. Only
 * periods that have plays and have ended are offered; a month still going
 * is listed when it has finished weeks, so they can be reached.
 */
export function recapTree(days = [], now = new Date()) {
  const years = new Map()
  const yearOf = (y) => {
    if (!years.has(y)) years.set(y, { year: y, months: new Map() })
    return years.get(y)
  }
  const monthOf = (y, m) => {
    const entry = yearOf(y)
    const key = `${y}-${pad(m)}`
    if (!entry.months.has(key)) entry.months.set(key, { year: y, month: m, key, hasPlays: false, weeks: new Map() })
    return entry.months.get(key)
  }
  for (const day of days) {
    const date = parseDay(day)
    if (Number.isNaN(date.getTime())) continue
    monthOf(date.getFullYear(), date.getMonth() + 1).hasPlays = true
    const monday = mondayOf(date)
    const thursday = new Date(monday)
    thursday.setDate(thursday.getDate() + 3)
    const week = { id: `w-${isoDay(monday)}`, scope: 'week', weekStart: isoDay(monday), year: monday.getFullYear() }
    if (periodEnd(week) > now) continue
    monthOf(thursday.getFullYear(), thursday.getMonth() + 1).weeks.set(week.id, withText(week))
  }
  const tree = []
  for (const entry of years.values()) {
    const months = []
    for (const month of entry.months.values()) {
      const period = { id: `m-${month.key}`, scope: 'month', year: month.year, month: month.month }
      const finished = periodEnd(period) <= now
      const weeks = [...month.weeks.values()].sort((a, b) => a.completedAt - b.completedAt)
      if (!month.hasPlays && !weeks.length) continue
      months.push({
        year: month.year, month: month.month, key: month.key,
        period: finished && month.hasPlays ? withText(period) : null,
        // A month still going: its recap so far (picked with a second click).
        soFar: !finished && month.hasPlays ? withText({ ...period, id: `${period.id}-so-far`, partial: true }) : null,
        weeks,
      })
    }
    if (!months.length) continue
    months.sort((a, b) => a.month - b.month)
    const yearPeriod = { id: `year-${entry.year}`, scope: 'year', year: entry.year }
    const yearFinished = periodEnd(yearPeriod) <= now
    tree.push({
      year: entry.year,
      period: yearFinished && months.some(m => m.period || m.weeks.length) ? withText(yearPeriod) : null,
      soFar: !yearFinished ? withText({ ...yearPeriod, id: `${yearPeriod.id}-so-far`, partial: true }) : null,
      months,
    })
  }
  return tree.sort((a, b) => b.year - a.year)
}

/** Every period on offer in a tree, flat. */
export function treePeriods(tree = []) {
  const all = []
  for (const year of tree) {
    if (year.period) all.push(year.period)
    if (year.soFar) all.push(year.soFar)
    for (const month of year.months) {
      if (month.period) all.push(month.period)
      if (month.soFar) all.push(month.soFar)
      all.push(...month.weeks)
    }
  }
  return all
}

/** The period that ended last (what to show first). "So far" ones never count. */
export function latestPeriod(tree = []) {
  return treePeriods(tree).filter(period => !period.partial).sort((a, b) => b.completedAt - a.completedAt)[0] || null
}

/** Where a period sits: { year, monthKey } (monthKey null for a whole year). */
export function periodPlace(tree = [], id) {
  for (const year of tree) {
    if (year.period?.id === id || year.soFar?.id === id) return { year: year.year, monthKey: null }
    for (const month of year.months) {
      if (month.period?.id === id || month.soFar?.id === id || month.weeks.some(w => w.id === id)) return { year: year.year, monthKey: month.key }
    }
  }
  return null
}

/** The listener's time zone, for asking which days have plays. */
export function listenerTimeZone() {
  return localTimeZone()
}

// The recaps the listener has opened, per user (recap ids are the same for
// every account). The sidebar's "new recap" badge is for a recap nobody has
// looked at yet: opening an older one afterwards (or a month "so far")
// mustn't bring it back, as keeping only the last one seen did.
const OPENED_KEY = 'lokal-recap-opened'
const OPENED_MAX = 200
// Before this list: the one recap last looked at, not tied to a user.
const LEGACY_KEY = 'lokal-recap-last-viewed'

const openedKey = (userId) => `${OPENED_KEY}:${userId || 'guest'}`

function readOpened(userId) {
  try {
    const key = openedKey(userId)
    const stored = localStorage.getItem(key)
    if (stored === null) {
      // First read for this user: the old key, if any, becomes their list,
      // once (then it's gone, so it can't count for a second account).
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (!legacy) return []
      localStorage.setItem(key, JSON.stringify([legacy]))
      localStorage.removeItem(LEGACY_KEY)
      return [legacy]
    }
    const list = JSON.parse(stored)
    return Array.isArray(list) ? list.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Remember that `userId` opened the recap `id`. */
export function markRecapOpened(id, userId) {
  if (!id) return
  const opened = readOpened(userId).filter(other => other !== id)
  opened.push(id)
  try { localStorage.setItem(openedKey(userId), JSON.stringify(opened.slice(-OPENED_MAX))) } catch {}
}

/** Has `userId` opened the recap `id`? */
export function recapOpened(id, userId) {
  return !!id && readOpened(userId).includes(id)
}
