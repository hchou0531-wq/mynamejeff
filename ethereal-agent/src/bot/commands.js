// Command router.
//
// Returns plain objects ({ text } or { photo, caption }) instead of talking to Telegram
// directly, which keeps every command unit-testable without a network or a bot token.
import { isAuthorized, denyAndLog, rateLimit } from './auth.js'
import { logAction } from '../database/actions.js'
import { deterministicAnalysis } from '../agent/prompts.js'
import { askAgent, fallbackAnswer } from '../agent/agent.js'
import { statusLabel } from '../ethereal/orders.js'
import { formatDailyBrief } from '../notifications/dailyBrief.js'
import { config } from '../config.js'

const money = n => `$${(Number(n) || 0).toFixed(2)}`

const HELP = `🤖 Ethereal Agent

/earnings — revenue, order counts and analysis
/orders [pending|fulfilled|today] — recent orders
/order <id> — full detail for one order
/dashboard [earnings|orders|analytics] — dashboard image
/brief — today's morning brief on demand
/fulfill <order_id> <code> — stage a Toy Code fulfillment
/confirm <order_id> — carry out a staged fulfillment
/help — this message

You can also just ask, e.g. "how much did I make today?"`

function icon(order) {
  if (order.status === 'paid') return order.fulfilled ? '🟢' : '🟡'
  if (order.status === 'pending_payment') return '🟡'
  if (order.status === 'failed') return '🔴'
  return '⚪️'
}

// Customer identifiers are trimmed to what's useful for support, never shown in full.
function maskBuyer(order) {
  const name = order.buyerInfo?.discordName || order.buyerName || 'unknown'
  const id = order.buyerInfo?.discordId
  return id ? `${name} (…${String(id).slice(-4)})` : String(name)
}

// Whether the bot should speak at all.
//
// In a 1:1 DM every message is meant for the bot, so it always answers. In a group it
// stays quiet unless actually spoken to — a slash command, an @mention, or a reply to one
// of its own messages — so it never talks over an ordinary conversation.
export function isAddressedToBot(message, botUsername) {
  const text = String(message?.text || '').trim()
  if (!text) return false

  // Telegram omits chat.type on nothing it sends, but default to the safer group
  // behaviour if it's ever missing rather than replying to everything.
  const chatType = message?.chat?.type || 'group'
  if (chatType === 'private') return true

  if (text.startsWith('/')) return true
  if (botUsername && new RegExp(`@${botUsername}\\b`, 'i').test(text)) return true
  if (message?.reply_to_message?.from?.is_bot) return true
  return false
}

// Removes the @mention so the question reads naturally to the model.
export function stripMention(text, botUsername) {
  if (!botUsername) return String(text || '').trim()
  return String(text || '').replace(new RegExp(`@${botUsername}\\b`, 'ig'), '').replace(/\s+/g, ' ').trim()
}

export function createRouter({ tools, cfg = config, botUsername = '' }) {
  async function cmdEarnings() {
    const e = await tools.get_earnings()
    const head = [
      '💰 Ethereal Earnings',
      '',
      `Today: ${money(e.revenue.today)}`,
      `This Week: ${money(e.revenue.week)}`,
      `This Month: ${money(e.revenue.month)}`,
      '',
      '📦 Orders',
      `Today: ${e.counts.today}`,
      `This Week: ${e.counts.week}`,
      `This Month: ${e.counts.month}`,
      '',
      '📈 Analysis',
      '',
    ]

    let analysis = null
    if (cfg.ai.enabled) {
      try {
        // The model receives the finished figures and may only describe them.
        const res = await askAgent(
          `Summarise these Ethereal figures for the owner in 3-4 short lines. Use only these numbers:\n${JSON.stringify(e)}`,
          tools,
        )
        analysis = res.text
      } catch { /* fall through to deterministic */ }
    }
    const body = analysis ? analysis.split('\n') : deterministicAnalysis(e)
    return { text: [...head, ...body].join('\n') }
  }

  async function cmdOrders(arg) {
    const filter = ['pending', 'fulfilled', 'today'].includes(arg) ? arg : 'recent'
    const orders = await tools.get_orders({ filter, limit: 8 })
    if (!orders.length) {
      return { text: `📦 No ${filter === 'recent' ? '' : filter + ' '}orders found.` }
    }
    const blocks = orders.map(o => [
      `#${o.txNumber ?? o.orderCode}`,
      o.item?.name || o.type || 'Order',
      money(o.amountUsd),
      `${icon(o)} ${statusLabel(o)}`,
    ].join('\n'))
    return { text: `📦 Orders${filter === 'recent' ? '' : ` (${filter})`}\n\n${blocks.join('\n\n')}` }
  }

  async function cmdOrder(id) {
    if (!id) return { text: 'Usage: /order <id>   e.g. /order 1042' }
    const o = await tools.get_order({ order_id: id })
    if (!o) return { text: `❌ Order #${id} not found.` }
    return {
      text: [
        `📦 Order #${o.txNumber ?? o.orderCode}`,
        '',
        `Product:\n${o.item?.name || o.type || 'Unknown'}`,
        '',
        `Price:\n${money(o.amountUsd)}`,
        '',
        `Status:\n${icon(o)} ${statusLabel(o)}`,
        '',
        `Customer:\n${maskBuyer(o)}`,
        '',
        `Created:\n${new Date(o.createdAt).toLocaleString()}`,
        '',
        `Fulfillment:\n${o.type === 'toycode' ? (o.fulfilled ? 'Code delivered' : 'Not fulfilled') : 'n/a (not a Toy Code order)'}`,
      ].join('\n'),
    }
  }

  async function cmdDashboard(section) {
    const valid = ['overview', 'earnings', 'orders', 'analytics']
    const sec = valid.includes(section) ? section : 'overview'
    const { png, caption } = await tools.get_dashboard_screenshot({ section: sec })
    return { photo: png, caption }
  }

  // Same content the scheduled 9am DM sends, on demand. Reads live data rather than
  // replaying the last brief, and doesn't consume the once-a-day marker.
  async function cmdBrief() {
    const [earnings, pending] = await Promise.all([
      tools.get_earnings(),
      tools.get_pending_orders(),
    ])
    const enriched = []
    for (const row of pending) {
      let txNumber = null
      try { txNumber = (await tools.get_order({ order_id: row.orderCode }))?.txNumber ?? null } catch {}
      enriched.push({ ...row, txNumber })
    }
    return { text: formatDailyBrief(earnings, enriched) }
  }

  async function cmdFulfill(userId, args) {
    const [orderId, ...codeParts] = args
    const code = codeParts.join(' ').trim()
    if (!orderId || !code) {
      return { text: 'Usage: /fulfill <order_id> <code>\n\ne.g. /fulfill 1042 ABCD-EFGH-IJKL' }
    }
    const res = await tools.prepare_toy_code_fulfillment({ order_id: orderId, code, userId })
    if (!res.ok) return { text: `❌ Cannot fulfill\n\n${res.reason}` }
    return {
      text: [
        '⚠️ Confirm Fulfillment',
        '',
        `Order: #${res.order.txNumber}`,
        `Product: ${res.order.itemName}`,
        `Amount: ${money(res.order.amountUsd)}`,
        '',
        `Code:\n${res.code}`,
        '',
        'Reply with:',
        `/confirm ${res.order.txNumber}`,
      ].join('\n'),
    }
  }

  async function cmdConfirm(userId, id) {
    if (!id) return { text: 'Usage: /confirm <order_id>' }
    const res = await tools.confirm_fulfillment({ order_id: id, userId })
    if (!res.ok) {
      return { text: [`❌ Fulfillment Failed`, '', `Order #${id} could not be fulfilled.`, '', `Reason:\n${res.reason}`, '', 'No further action was taken.'].join('\n') }
    }
    return {
      text: [
        '✅ Order Fulfilled',
        '',
        `Order #${res.order.txNumber} has been successfully fulfilled.`,
        '',
        `Product:\n${res.order.itemName}`,
        '',
        'Status:\n🟢 Fulfilled',
      ].join('\n'),
    }
  }

  async function handleMessage(message) {
    const userId = message?.from?.id
    const raw = String(message?.text || '').trim()
    if (!raw) return null

    // Silence is the default. Checked before auth so an unauthorized stranger chatting
    // away gets nothing back either — the bot only ever reveals itself when addressed.
    if (!isAddressedToBot(message, botUsername)) return null

    const text = stripMention(raw, botUsername)
    if (!text) return { text: HELP } // bare "@bot" with nothing after it

    if (!isAuthorized(userId, cfg)) return { text: denyAndLog(userId, text.split(' ')[0]) }

    const limit = rateLimit(userId)
    if (!limit.allowed) {
      return { text: `⏳ Slow down a moment — try again in ${limit.retryAfterSec}s.` }
    }

    const [rawCmd, ...args] = text.split(/\s+/)
    // Telegram appends @botname when commands are used in groups.
    const cmd = rawCmd.toLowerCase().split('@')[0]

    try {
      switch (cmd) {
        case '/start':
        case '/help':
          logAction({ userId, command: cmd, action: 'help', result: 'ok' })
          return { text: HELP }
        case '/earnings':
          logAction({ userId, command: cmd, action: 'get_earnings', result: 'ok' })
          return await cmdEarnings()
        case '/orders':
          logAction({ userId, command: cmd, action: 'get_orders', result: 'ok' })
          return await cmdOrders(args[0]?.toLowerCase())
        case '/order':
          logAction({ userId, command: cmd, orderId: args[0], action: 'get_order', result: 'ok' })
          return await cmdOrder(args[0])
        case '/dashboard':
          logAction({ userId, command: cmd, action: 'get_dashboard', result: 'ok' })
          return await cmdDashboard(args[0]?.toLowerCase())
        case '/brief':
          logAction({ userId, command: cmd, action: 'daily_brief_manual', result: 'ok' })
          return await cmdBrief()
        case '/fulfill':
          // The code itself is never logged.
          return await cmdFulfill(userId, args)
        case '/confirm':
          return await cmdConfirm(userId, args[0])
        default:
          break
      }

      if (cmd.startsWith('/')) return { text: `Unknown command ${cmd}\n\n${HELP}` }

      // Free text → natural language path.
      if (cfg.ai.enabled) {
        try {
          const res = await askAgent(text, tools, { cfg })
          if (res.text) {
            logAction({ userId, command: 'nl', action: 'ask_agent', result: 'ok' })
            return { text: res.text }
          }
        } catch { /* fall back below */ }
      }
      const fb = await fallbackAnswer(text, tools)
      if (fb) {
        logAction({ userId, command: 'nl', action: 'fallback_answer', result: 'ok' })
        return { text: fb }
      }
      return { text: `I can help with earnings, orders and fulfillment.\n\n${HELP}` }
    } catch (e) {
      logAction({ userId, command: cmd, action: 'error', result: 'error', detail: e.message })
      return { text: `⚠️ ${e.message}` }
    }
  }

  return { handleMessage, HELP }
}
