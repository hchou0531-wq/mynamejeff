// Earnings + analytics, computed from real Ethereal order data.
//
// Every figure here is derived arithmetically from orders the API returned. The AI layer
// is only ever handed these finished numbers to describe — it never produces one itself.
import { client } from './client.js'
import { listPendingFulfillment } from './orders.js'

const DAY_MS = 24 * 60 * 60 * 1000

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function sum(orders) {
  return Math.round(orders.reduce((a, o) => a + (Number(o.amountUsd) || 0), 0) * 100) / 100
}

export async function getEarnings({ deps = { client } } = {}) {
  const { orders = [] } = await deps.client.request('/admin/orders')
  const paid = orders.filter(o => o.status === 'paid')

  const today = startOfToday()
  const weekAgo = new Date(today.getTime() - 6 * DAY_MS) // today inclusive = 7 days
  const prevWeekStart = new Date(today.getTime() - 13 * DAY_MS)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const yesterday = new Date(today.getTime() - DAY_MS)
  const dayBefore = new Date(today.getTime() - 2 * DAY_MS)

  const paidAt = o => new Date(o.paidAt || o.createdAt)

  const paidToday = paid.filter(o => paidAt(o) >= today)
  const paidYesterday = paid.filter(o => paidAt(o) >= yesterday && paidAt(o) < today)
  const paidDayBefore = paid.filter(o => paidAt(o) >= dayBefore && paidAt(o) < yesterday)
  const paidWeek = paid.filter(o => paidAt(o) >= weekAgo)
  const paidPrevWeek = paid.filter(o => paidAt(o) >= prevWeekStart && paidAt(o) < weekAgo)
  const paidMonth = paid.filter(o => paidAt(o) >= monthStart)

  const created = d => new Date(d.createdAt)
  const pending = await listPendingFulfillment({ deps })

  const revenue = {
    today: sum(paidToday),
    yesterday: sum(paidYesterday),
    dayBefore: sum(paidDayBefore),
    week: sum(paidWeek),
    prevWeek: sum(paidPrevWeek),
    month: sum(paidMonth),
    allTime: sum(paid),
  }

  const counts = {
    today: orders.filter(o => created(o) >= today).length,
    week: orders.filter(o => created(o) >= weekAgo).length,
    month: orders.filter(o => created(o) >= monthStart).length,
    allTime: orders.length,
    paidAllTime: paid.length,
    awaitingFulfillment: pending.length,
  }

  // Revenue by product type, so "strongest category" is measured, not guessed.
  const byType = {}
  for (const o of paid) {
    const key = o.type || 'other'
    byType[key] = byType[key] || { revenue: 0, orders: 0 }
    byType[key].revenue = Math.round((byType[key].revenue + (Number(o.amountUsd) || 0)) * 100) / 100
    byType[key].orders += 1
  }
  const topCategory = Object.entries(byType).sort((a, b) => b[1].revenue - a[1].revenue)[0] || null

  const weekChangePct = revenue.prevWeek > 0
    ? Math.round(((revenue.week - revenue.prevWeek) / revenue.prevWeek) * 1000) / 10
    : null
  const dayChangePct = revenue.yesterday > 0
    ? Math.round(((revenue.today - revenue.yesterday) / revenue.yesterday) * 1000) / 10
    : null
  // Yesterday vs the day before. The morning brief must use THIS, not dayChangePct —
  // at 9am "today" is barely started, so today-vs-yesterday reads as a ~100% crash
  // every single morning.
  const yesterdayChangePct = revenue.dayBefore > 0
    ? Math.round(((revenue.yesterday - revenue.dayBefore) / revenue.dayBefore) * 1000) / 10
    : null

  return {
    revenue,
    counts,
    byType,
    topCategory: topCategory ? { name: topCategory[0], ...topCategory[1] } : null,
    averageOrderValue: paid.length ? Math.round((revenue.allTime / paid.length) * 100) / 100 : 0,
    weekChangePct,
    dayChangePct,
    yesterdayChangePct,
    generatedAt: new Date().toISOString(),
  }
}

export async function getMonthlySeries({ range = '3m', deps = { client } } = {}) {
  return deps.client.request(`/admin/dashboard/analytics/revenue?range=${encodeURIComponent(range)}`)
}

export async function getUserSeries({ range = '3m', deps = { client } } = {}) {
  return deps.client.request(`/admin/dashboard/analytics/users?range=${encodeURIComponent(range)}`)
}
