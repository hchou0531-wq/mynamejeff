// Morning brief: one DM a day with yesterday's takings and anything still to fulfill.
//
// Scheduling is a once-a-minute "is it time yet?" check rather than a long setTimeout.
// That is immune to clock drift, sleep/wake, and daylight-saving shifts — a timer armed
// for "in 14 hours" silently fires at the wrong local time when the clocks change, or
// not at all if the machine sleeps through it.
import { readState, writeState } from '../database/db.js'
import { logAction } from '../database/actions.js'
import { config } from '../config.js'

const money = n => `$${(Number(n) || 0).toFixed(2)}`

export function localDateKey(d = new Date()) {
  // Local calendar date, not UTC — "today" must mean today where the owner is.
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDailyBrief(earnings, pending, now = new Date()) {
  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const lines = [
    '🌅 Good morning',
    dateLine,
    '',
    '💰 Revenue',
    `Yesterday: ${money(earnings.revenue.yesterday)}`,
    `This week: ${money(earnings.revenue.week)}`,
    `This month: ${money(earnings.revenue.month)}`,
  ]

  // Yesterday vs the day before — NOT today-vs-yesterday, which at 9am would report a
  // near-total collapse every morning. Omitted entirely when flat or uncomparable.
  const chg = earnings.yesterdayChangePct
  if (chg !== null && chg !== undefined && chg !== 0) {
    lines.push(`(${chg > 0 ? 'up' : 'down'} ${Math.abs(chg)}% on the day before)`)
  }

  lines.push('', '📦 To fulfill')
  if (!pending.length) {
    lines.push('Nothing waiting — you are all caught up. ✅')
  } else {
    lines.push(`${pending.length} order${pending.length === 1 ? '' : 's'} awaiting a code:`, '')
    for (const p of pending.slice(0, 15)) {
      const ref = p.txNumber ?? p.orderCode
      lines.push(`#${ref} — ${p.title || 'Toy Code'}`)
      lines.push(`/fulfill ${ref} <toy_code>`)
      lines.push('')
    }
    if (pending.length > 15) lines.push(`…and ${pending.length - 15} more. Send /orders pending for the full list.`)
  }

  return lines.join('\n').trimEnd()
}

// True when the brief is due: it's on/after the scheduled local time, we haven't already
// sent today, and we're still inside the catch-up window (so a machine that was asleep at
// 09:00 still gets it on wake, but starting the bot at midnight doesn't fire a stale one).
export function isBriefDue(now, cfg = config, state = readState()) {
  const { hour, minute, catchUpHours } = cfg.dailyBrief
  if (hour < 0) return false
  if (state.lastBriefDate === localDateKey(now)) return false

  const scheduled = new Date(now)
  scheduled.setHours(hour, minute, 0, 0)
  if (now < scheduled) return false

  const hoursLate = (now - scheduled) / 3_600_000
  return hoursLate <= catchUpHours
}

export async function sendDailyBrief({ tools, send, cfg = config, now = new Date() }) {
  const [earnings, pending] = await Promise.all([
    tools.get_earnings(),
    tools.get_pending_orders(),
  ])

  // Resolve human-facing order numbers so the /fulfill lines are copy-pasteable.
  const enriched = []
  for (const row of pending) {
    let txNumber = null
    try {
      const order = await tools.get_order({ order_id: row.orderCode })
      txNumber = order?.txNumber ?? null
    } catch { /* fall back to the order code */ }
    enriched.push({ ...row, txNumber })
  }

  const text = formatDailyBrief(earnings, enriched, now)

  let delivered = false
  for (const userId of cfg.telegram.allowedUserIds) {
    try {
      await send(userId, text)
      delivered = true
    } catch (e) {
      logAction({ userId, command: 'daily_brief', action: 'daily_brief', result: 'error', detail: e.message })
    }
  }

  // Only stamp the day as done if it actually reached someone — otherwise the catch-up
  // window gives it another go rather than silently skipping the day.
  if (delivered) {
    writeState({ lastBriefDate: localDateKey(now) })
    logAction({ userId: 'system', command: 'daily_brief', action: 'daily_brief', result: 'ok', detail: `${enriched.length} pending` })
  }
  return { delivered, pending: enriched.length }
}

export function startDailyBrief({ tools, send, cfg = config, onError = console.error, intervalMs = 60_000 }) {
  if (cfg.dailyBrief.hour < 0) return () => {}

  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const now = new Date()
      if (isBriefDue(now, cfg)) await sendDailyBrief({ tools, send, cfg, now })
    } catch (e) {
      onError(`daily brief failed: ${e.message}`)
    }
  }
  const handle = setInterval(tick, intervalMs)
  setTimeout(tick, 8000) // let the API settle after boot
  return () => { stopped = true; clearInterval(handle) }
}
