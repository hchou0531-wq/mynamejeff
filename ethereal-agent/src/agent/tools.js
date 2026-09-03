// The complete set of actions the agent may perform.
//
// This is the security boundary: the LLM can only ever ask for one of these by name with
// validated arguments. It has no database handle, no HTTP client, and no way to reach an
// Ethereal route that isn't represented here.
import { getEarnings, getMonthlySeries, getUserSeries } from '../ethereal/earnings.js'
import {
  listOrders, getOrderByTxNumber, listPendingFulfillment,
  validateFulfillment, fulfillToyCode,
} from '../ethereal/orders.js'
import { renderDashboard } from '../ethereal/dashboard.js'
import { stageFulfillment, getStagedFulfillment, clearStagedFulfillment } from '../database/orders.js'
import { logAction } from '../database/actions.js'
import { client } from '../ethereal/client.js'

export function buildTools({ deps = { client } } = {}) {
  return {
    async get_earnings() {
      return getEarnings({ deps })
    },

    async get_analytics({ range = '3m' } = {}) {
      const [earnings, revenue, users] = await Promise.all([
        getEarnings({ deps }),
        getMonthlySeries({ range, deps }).catch(() => ({ series: [] })),
        getUserSeries({ range, deps }).catch(() => ({ series: [], total: 0 })),
      ])
      return { earnings, revenue, users }
    },

    async get_orders({ filter = 'recent', limit = 10 } = {}) {
      return listOrders({ filter, limit, deps })
    },

    async get_order({ order_id } = {}) {
      if (order_id == null || order_id === '') throw new Error('order_id is required')
      return getOrderByTxNumber(order_id, { deps })
    },

    async get_pending_orders() {
      return listPendingFulfillment({ deps })
    },

    async get_dashboard_screenshot({ section = 'overview' } = {}) {
      return renderDashboard(section, { deps })
    },

    // Stages a fulfillment. Deliberately performs NO write — it validates and parks the
    // request so a human /confirm is always the thing that actually delivers a code.
    async prepare_toy_code_fulfillment({ order_id, code, userId } = {}) {
      const check = await validateFulfillment(order_id, code, { deps })
      if (!check.ok) {
        logAction({ userId, command: '/fulfill', orderId: order_id, action: 'prepare_fulfillment', result: 'error', detail: check.reason })
        return { ok: false, reason: check.reason }
      }
      stageFulfillment(userId, {
        txNumber: check.order.txNumber,
        orderCode: check.orderCode,
        toycodeId: check.toycodeId,
        code: String(code).trim(),
        itemName: check.order.item?.name || 'Toy Code',
        amountUsd: check.order.amountUsd,
      })
      logAction({ userId, command: '/fulfill', orderId: order_id, action: 'prepare_fulfillment', result: 'pending', detail: 'awaiting /confirm' })
      return {
        ok: true,
        order: {
          txNumber: check.order.txNumber,
          itemName: check.order.item?.name || 'Toy Code',
          amountUsd: check.order.amountUsd,
        },
        code: String(code).trim(),
      }
    },

    // Executes a previously staged fulfillment. Reports success only if Ethereal says so.
    async confirm_fulfillment({ order_id, userId } = {}) {
      const staged = getStagedFulfillment(userId, order_id)
      if (!staged.ok) {
        const reason = staged.reason === 'expired'
          ? 'That confirmation expired. Run /fulfill again.'
          : staged.reason === 'mismatch'
            ? `You have a pending fulfillment for #${staged.entry.txNumber}, not #${order_id}.`
            : `Nothing staged to confirm. Run /fulfill <order_id> <code> first.`
        logAction({ userId, command: '/confirm', orderId: order_id, action: 'confirm_fulfillment', result: 'error', detail: reason })
        return { ok: false, reason }
      }

      const entry = staged.entry
      // Re-validate immediately before writing: the order may have been fulfilled
      // elsewhere (Discord dashboard, another operator) since it was staged.
      const recheck = await validateFulfillment(entry.txNumber, entry.code, { deps })
      if (!recheck.ok) {
        clearStagedFulfillment(userId)
        logAction({ userId, command: '/confirm', orderId: order_id, action: 'confirm_fulfillment', result: 'error', detail: recheck.reason })
        return { ok: false, reason: recheck.reason }
      }

      try {
        await fulfillToyCode({
          toycodeId: entry.toycodeId,
          orderCode: entry.orderCode,
          code: entry.code,
          deps,
        })
      } catch (e) {
        logAction({ userId, command: '/confirm', orderId: order_id, action: 'confirm_fulfillment', result: 'error', detail: e.message })
        return { ok: false, reason: e.message }
      }

      clearStagedFulfillment(userId)
      logAction({ userId, command: '/confirm', orderId: order_id, action: 'confirm_fulfillment', result: 'ok', detail: 'code delivered' })
      return {
        ok: true,
        order: { txNumber: entry.txNumber, itemName: entry.itemName, amountUsd: entry.amountUsd },
      }
    },
  }
}

// Machine-readable descriptions handed to the LLM. Read-only tools only: anything that
// writes (fulfillment) is driven by explicit slash commands, never by model choice.
export const READONLY_TOOL_SPECS = [
  { name: 'get_earnings', description: 'Revenue and order counts for today, this week and this month, plus averages and trends.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_analytics', description: 'Monthly revenue and user-signup series plus earnings summary.', input_schema: { type: 'object', properties: { range: { type: 'string', enum: ['3m', '6m', '9m', '1y'] } } } },
  { name: 'get_orders', description: 'Recent orders. filter: recent | pending | fulfilled | today.', input_schema: { type: 'object', properties: { filter: { type: 'string', enum: ['recent', 'pending', 'fulfilled', 'today'] }, limit: { type: 'number' } } } },
  { name: 'get_order', description: 'Full detail for one order by its number.', input_schema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] } },
  { name: 'get_pending_orders', description: 'Toy-code orders that are paid and awaiting a code.', input_schema: { type: 'object', properties: {} } },
]
