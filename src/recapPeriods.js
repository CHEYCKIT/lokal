// Listening recap periods: weeks (Monday to Sunday), quarters and years.
// A period only shows once it has ended. Shared by the Recap page and the
// sidebar's "new recap" badge; the backend (electron/ipc/recaps.js) turns
// { scope, weekStart | quarter, year } into the same time range.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// How far back each kind of recap is offered.
const WEEKS_BACK = 12
const QUARTER_YEARS_BACK = 2
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
  if (period.scope === 'quarter') return new Date(period.year, period.quarter * 3, 1)
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

/** "Week of Sep 21–27, 2026 Recap", "January-March 2026 Recap", "January-December 2026 Recap". */
export function periodTitle(period) {
  if (!period) return 'Recap'
  if (period.scope === 'week') return `Week of ${weekRangeText(period, true)} Recap`
  const start = period.scope === 'year' ? 0 : (period.quarter - 1) * 3
  const end = period.scope === 'year' ? 11 : start + 2
  return `${MONTHS[start]}-${MONTHS[end]} ${period.year} Recap`
}

/** Short label for the period chips: "Sep 21–27", "Jan-Mar 2026", "Jan-Dec 2026". */
export function periodLabel(period) {
  if (!period) return ''
  if (period.scope === 'week') return weekRangeText(period)
  const start = period.scope === 'year' ? 0 : (period.quarter - 1) * 3
  const end = period.scope === 'year' ? 11 : start + 2
  return `${SHORT_MONTHS[start]}-${SHORT_MONTHS[end]} ${period.year}`
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
  const year = now.getFullYear()
  for (let y = year; y >= year - QUARTER_YEARS_BACK; y -= 1) {
    for (let q = 4; q >= 1; q -= 1) {
      const quarterly = { id: `q${q}-${y}`, scope: 'quarter', year: y, quarter: q }
      if (periodEnd(quarterly) <= now) periods.push(withText(quarterly))
    }
  }
  for (let y = year; y >= year - YEARS_BACK; y -= 1) {
    const yearly = { id: `year-${y}`, scope: 'year', year: y }
    if (periodEnd(yearly) <= now) periods.push(withText(yearly))
  }
  return periods.sort((left, right) => right.completedAt - left.completedAt)
}

/** What the backend needs to build a period's recap. */
export function periodQuery(period, extra = {}) {
  if (period.scope === 'week') return { scope: 'week', weekStart: period.weekStart, ...extra }
  if (period.scope === 'quarter') return { scope: 'quarter', year: period.year, quarter: period.quarter, ...extra }
  return { scope: 'year', year: period.year, ...extra }
}
