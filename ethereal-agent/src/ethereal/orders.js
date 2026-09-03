// Order reads and toy-code fulfillment against the Ethereal API.
import { client, EtherealError } from './client.js'

export const STATUS_ICON = {
  paid: '🟢',
  pending_payment: '🟡',
  failed: '🔴',
  refunded: '⚪️',
}

export function statusLabel(order) {
  if (order.status === 'pending_payment') return 'Awaiting payment'
  if (order.status === 'paid') return order.fulfilled ? 'Fulfilled' : 'Awaiting fulfillment'
  return order.status
}

export async function listOrders({ limit = 10, filter = 'recent', deps = { client } } = {}) {
  const { orders = [] } = await deps.client.request('/admin/orders')
  const pending = await listPendingFulfillment({ deps })
  const pendingCodes = new Set(pending.map(p => p.orderCode))

  // An order is "fulfilled" when it's paid and no longer waiting in the pending queue.
  const enriched = orders.map(o => ({
    ...o,
    fulfilled: o.status === 'paid' && o.type === 'toycode' ? !pendingCodes.has(o.orderCode) : o.status === 'paid',
  }))

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  let rows = enriched
  if (filter === 'pending') rows = enriched.filter(o => o.type === 'toycode' && pendingCodes.has(o.orderCode))
  else if (filter === 'fulfilled') rows = enriched.filter(o => o.fulfilled)
  else if (filter === 'today') rows = enriched.filter(o => new Date(o.createdAt) >= startOfToday)

  return rows.slice(0, limit)
}

export async function getOrderByTxNumber(txNumber, { deps = { client } } = {}) {
  const { orders = [] } = await deps.client.request('/admin/orders')
  const wanted = String(txNumber).replace(/^#/, '')
  const order = orders.find(o => String(o.txNumber) === wanted || String(o.orderCode).toLowerCase() === wanted.toLowerCase())
  if (!order) return null

  const pending = await listPendingFulfillment({ deps })
  const pendingRow = pending.find(p => p.orderCode === order.orderCode)
  return {
    ...order,
    fulfilled: order.status === 'paid' && (order.type === 'toycode' ? !pendingRow : true),
    pendingRow: pendingRow || null,
  }
}

export async function listPendingFulfillment({ deps = { client } } = {}) {
  const { pending = [] } = await deps.client.request('/admin/dashboard/toycodes-pending')
  return pending
}

// Validates everything the spec requires BEFORE any write happens. Returns a plain
// result object rather than throwing, so the bot can explain exactly what's wrong.
export async function validateFulfillment(txNumber, code, { deps = { client } } = {}) {
  if (!code || !String(code).trim()) {
    return { ok: false, reason: 'A toy code is required: /fulfill <order_id> <code>' }
  }
  const order = await getOrderByTxNumber(txNumber, { deps })
  if (!order) return { ok: false, reason: `Order #${txNumber} does not exist in Ethereal.` }
  if (order.type !== 'toycode') {
    return { ok: false, reason: `Order #${txNumber} is a "${order.type}" order, not a Toy Code. Only Toy Code orders can be fulfilled here.` }
  }
  if (order.status !== 'paid') {
    return { ok: false, reason: `Order #${txNumber} is not paid yet (status: ${order.status}). Nothing to fulfill.` }
  }
  if (!order.pendingRow) {
    return { ok: false, reason: `Order #${txNumber} is already fulfilled — its code has been delivered.` }
  }
  return {
    ok: true,
    order,
    toycodeId: order.pendingRow.toycodeId,
    orderCode: order.orderCode,
  }
}

// Performs the write. Only ever called after validateFulfillment + explicit /confirm.
export async function fulfillToyCode({ toycodeId, orderCode, code, deps = { client } }) {
  const res = await deps.client.request(`/admin/dashboard/toycodes/${toycodeId}/fulfill`, {
    method: 'POST',
    body: { orderCode, code: String(code).trim() },
  })
  if (!res || res.success !== true) {
    throw new EtherealError('Ethereal did not confirm the fulfillment.', { route: '/fulfill' })
  }
  return res
}
