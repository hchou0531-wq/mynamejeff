// A stand-in for the Ethereal API that mirrors the real route shapes exactly
// (verified against app/api/[[...path]]/route.js), so command logic can be tested
// without a live backend or database.
export function makeFakeEthereal({ now = new Date() } = {}) {
  // Anchor every fixture to start-of-today rather than "hours ago", so the buckets the
  // tests assert on can't drift when the suite happens to run near midnight or on the
  // first of a month.
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const iso = d => new Date(d).toISOString()
  const hoursAgo = h => iso(startOfToday.getTime() + (12 - h) * 3600_000) // midday-ish today
  const daysAgo = d => iso(startOfToday.getTime() - d * 86400_000 + 12 * 3600_000)

  const state = {
    calls: [],
    orders: [
      // paid toy code, still awaiting its code → the fulfillable one
      { id: 'o1', orderId: 'ord_1', orderCode: 'AB12CD', txNumber: 1042, type: 'toycode', toycodeId: 'tc1',
        item: { name: 'Roblox Toy Code' }, buyerName: 'buyer1', buyerInfo: { discordName: 'buyer1', discordId: '123456789012345678' },
        amountUsd: 15, currency: 'USD', status: 'paid', createdAt: hoursAgo(2), paidAt: hoursAgo(2) },
      // paid toy code, already fulfilled (not in pending list)
      { id: 'o2', orderId: 'ord_2', orderCode: 'EF34GH', txNumber: 1041, type: 'toycode', toycodeId: 'tc1',
        item: { name: 'Roblox Toy Code' }, buyerName: 'buyer2', buyerInfo: { discordName: 'buyer2', discordId: '223456789012345678' },
        amountUsd: 25, currency: 'USD', status: 'paid', createdAt: hoursAgo(5), paidAt: hoursAgo(5) },
      // paid, but NOT a toy code
      { id: 'o3', orderId: 'ord_3', orderCode: 'IJ56KL', txNumber: 1040, type: 'listing',
        item: { name: 'Limited Item' }, buyerName: 'buyer3', buyerInfo: {},
        amountUsd: 40, currency: 'USD', status: 'paid', createdAt: daysAgo(1), paidAt: daysAgo(1) },
      // toy code that has not been paid for
      { id: 'o4', orderId: 'ord_4', orderCode: 'MN78OP', txNumber: 1039, type: 'toycode', toycodeId: 'tc1',
        item: { name: 'Roblox Toy Code' }, buyerName: 'buyer4', buyerInfo: { discordName: 'buyer4', discordId: '323456789012345678' },
        amountUsd: 10, currency: 'USD', status: 'pending_payment', createdAt: daysAgo(9), paidAt: null },
      // older paid order, for previous-week comparison
      { id: 'o5', orderId: 'ord_5', orderCode: 'QR90ST', txNumber: 1038, type: 'toycode', toycodeId: 'tc1',
        item: { name: 'Roblox Toy Code' }, buyerName: 'buyer5', buyerInfo: {},
        amountUsd: 20, currency: 'USD', status: 'paid', createdAt: daysAgo(9), paidAt: daysAgo(9) },
    ],
    // mirrors the toycodes.pendingOrders entries with an empty `code`
    pending: [
      { toycodeId: 'tc1', title: 'Roblox Toy Code', orderCode: 'AB12CD', discordName: 'buyer1', createdAt: hoursAgo(2) },
    ],
    fulfillCalls: [],
    failFulfillWith: null,
  }

  const client = {
    async request(route, opts = {}) {
      state.calls.push({ route, method: opts.method || 'GET' })

      if (route === '/admin/orders') return { orders: state.orders.map(o => ({ ...o })) }
      if (route === '/admin/dashboard/toycodes-pending') return { pending: state.pending.map(p => ({ ...p })) }

      if (route.startsWith('/admin/dashboard/analytics/revenue')) {
        return { range: '3m', series: [{ month: '2026-07', revenue: 40, orders: 2 }, { month: '2026-08', revenue: 60, orders: 3 }], month: null }
      }
      if (route.startsWith('/admin/dashboard/analytics/users')) {
        return { range: '3m', series: [{ month: '2026-08', users: 4 }], total: 4 }
      }

      const m = route.match(/^\/admin\/dashboard\/toycodes\/(.+)\/fulfill$/)
      if (m && opts.method === 'POST') {
        if (state.failFulfillWith) return Promise.reject(new Error(state.failFulfillWith))
        const { orderCode, code } = opts.body || {}
        const idx = state.pending.findIndex(p => p.orderCode === orderCode && p.toycodeId === m[1])
        if (idx === -1) { const e = new Error('Pending order not found'); e.status = 404; throw e }
        state.pending.splice(idx, 1) // delivered → leaves the pending queue
        state.fulfillCalls.push({ toycodeId: m[1], orderCode, code })
        return { success: true }
      }

      throw new Error(`fake: unhandled route ${route}`)
    },
  }

  return { client, state }
}
