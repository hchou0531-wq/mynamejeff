// Background watcher: pings the operator when a paid Toy Code order needs a code.
// It only ever notifies — fulfillment always requires the human /fulfill + /confirm pair.
import { isAlreadyNotified, markNotified } from '../database/orders.js'
import { logAction } from '../database/actions.js'
import { config } from '../config.js'

const money = n => `$${(Number(n) || 0).toFixed(2)}`

export function formatPendingNotice(row, order) {
  return [
    '🔔 New Order Requires Fulfillment',
    '',
    `Order: #${order?.txNumber ?? row.orderCode}`,
    `Product: ${row.title || 'Roblox Toy Code'}`,
    order ? `Price: ${money(order.amountUsd)}` : null,
    '',
    'Use:',
    '',
    `/fulfill ${order?.txNumber ?? row.orderCode} <toy_code>`,
  ].filter(v => v !== null).join('\n')
}

// One sweep. Exported separately from the loop so tests can drive it directly.
export async function checkPending({ tools, send, cfg = config }) {
  const pending = await tools.get_pending_orders()
  const fresh = pending.filter(p => !isAlreadyNotified(p.orderCode))
  if (!fresh.length) return { notified: 0 }

  const delivered = []
  let lastError = null

  for (const row of fresh) {
    // Resolve the human-facing order number so the operator can use it verbatim.
    let order = null
    try { order = await tools.get_order({ order_id: row.orderCode }) } catch { /* optional */ }

    // A single undeliverable operator (e.g. they haven't opened the chat with the bot
    // yet, so Telegram returns "chat not found") must not abort the whole sweep or
    // suppress the other operators' notices.
    let anyDelivered = false
    for (const userId of cfg.telegram.allowedUserIds) {
      try {
        await send(userId, formatPendingNotice(row, order))
        anyDelivered = true
      } catch (e) {
        lastError = e
        logAction({ userId, command: 'notify', orderId: order?.txNumber ?? row.orderCode, action: 'pending_notice', result: 'error', detail: e.message })
      }
    }

    // Only remember it as notified if it actually reached someone — otherwise it stays
    // queued and is retried on the next sweep.
    if (anyDelivered) {
      delivered.push(row.orderCode)
      logAction({ userId: 'system', command: 'notify', orderId: order?.txNumber ?? row.orderCode, action: 'pending_notice', result: 'ok' })
    }
  }

  if (delivered.length) markNotified(delivered)
  return { notified: delivered.length, failed: fresh.length - delivered.length, lastError }
}

export function startPendingWatcher({ tools, send, cfg = config, onError = console.error }) {
  const seconds = Number(cfg.notify.pollSeconds)
  if (!seconds || seconds <= 0) return () => {}

  let stopped = false
  const tick = async () => {
    if (stopped) return
    try { await checkPending({ tools, send, cfg }) } catch (e) { onError(`notify sweep failed: ${e.message}`) }
  }
  const handle = setInterval(tick, seconds * 1000)
  // Don't fire immediately — give the API a moment after boot.
  setTimeout(tick, 5000)
  return () => { stopped = true; clearInterval(handle) }
}
