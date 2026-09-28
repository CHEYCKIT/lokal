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
  if (period.scope === 'month') return `${MONTHS[period.month - 1]} ${period.year} Recap`
  return `${period.year} Recap`
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
  if (period.scope === 'month') return { scope: 'month', year: period.year, month: period.month, tz: localTimeZone(), ...extra }
  return { scope: 'year', year: period.year, ...extra }
}
