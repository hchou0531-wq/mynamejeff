// Natural-language layer.
//
// Slash commands are the primary interface and never touch this file. Free-text messages
// land here, where the model may call read-only tools to fetch real data before answering.
// If no AI key is configured we fall back to keyword routing so plain questions still work.
import { config } from '../config.js'
import { SYSTEM_PROMPT, deterministicAnalysis } from './prompts.js'
import { READONLY_TOOL_SPECS } from './tools.js'

const AI_URL = 'https://api.anthropic.com/v1/messages'

async function callClaude(messages, tools, { cfg = config, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(AI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.ai.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.ai.model,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`AI request failed (HTTP ${res.status}) ${body.slice(0, 200)}`)
  }
  return res.json()
}

// Runs the model with a bounded tool loop. Tools are read-only, so the worst case is
// wasted calls, not an unintended write.
export async function askAgent(question, tools, { cfg = config, fetchImpl = fetch, maxTurns = 4 } = {}) {
  if (!cfg.ai.enabled) return { text: null, usedAi: false }

  const messages = [{ role: 'user', content: question }]

  for (let turn = 0; turn < maxTurns; turn++) {
    const reply = await callClaude(messages, READONLY_TOOL_SPECS, { cfg, fetchImpl })
    const toolUses = (reply.content || []).filter(b => b.type === 'tool_use')

    if (!toolUses.length) {
      const text = (reply.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      return { text: text || null, usedAi: true }
    }

    messages.push({ role: 'assistant', content: reply.content })
    const results = []
    for (const use of toolUses) {
      const fn = tools[use.name]
      let payload
      try {
        payload = fn
          ? await fn(use.input || {})
          : { error: `Unknown tool ${use.name}` }
      } catch (e) {
        payload = { error: e.message }
      }
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(payload ?? null).slice(0, 12000),
      })
    }
    messages.push({ role: 'user', content: results })
  }
  return { text: null, usedAi: true }
}

// Keyword routing used when there's no AI key (or the AI call fails). Deliberately
// conservative: it only answers things it can answer from real tool output.
export async function fallbackAnswer(question, tools) {
  const q = String(question || '').toLowerCase()
  const money = n => `$${(Number(n) || 0).toFixed(2)}`

  const asksFulfil = /fulfil|pending|need|outstanding|waiting/.test(q)
  // Covers the natural phrasings people actually type: "made", "make", "making",
  // "how much did I earn", "what did I take today".
  const asksEarnings = /earn|revenue|mad[e]|mak(e|ing)|money|sales|income|profit|took|taken/.test(q)
  const asksOrders = /order/.test(q)

  if (asksFulfil) {
    const pending = await tools.get_pending_orders()
    if (!pending.length) return '✅ Nothing is awaiting fulfillment right now.'
    const lines = pending.slice(0, 10).map(p => `#${p.orderCode} — ${p.title || 'Toy Code'}`)
    return `📦 ${pending.length} order${pending.length === 1 ? '' : 's'} need fulfillment:\n\n${lines.join('\n')}\n\nFulfill with: /fulfill <order_id> <code>`
  }

  if (asksEarnings) {
    const e = await tools.get_earnings()
    const today = /today/.test(q)
    const week = /week/.test(q)
    const month = /month/.test(q)
    if (today) {
      const trend = e.dayChangePct === null ? '' : `\n\nThat's ${e.dayChangePct >= 0 ? 'up' : 'down'} ${Math.abs(e.dayChangePct)}% versus yesterday.`
      return `💰 You made ${money(e.revenue.today)} today.${trend}`
    }
    if (week) return `💰 ${money(e.revenue.week)} over the last 7 days.`
    if (month) return `💰 ${money(e.revenue.month)} this month.`
    return [
      `💰 Today: ${money(e.revenue.today)}`,
      `This week: ${money(e.revenue.week)}`,
      `This month: ${money(e.revenue.month)}`,
      '',
      ...deterministicAnalysis(e),
    ].join('\n')
  }

  if (asksOrders) {
    const orders = await tools.get_orders({ filter: 'recent', limit: 5 })
    if (!orders.length) return 'No orders recorded yet.'
    const lines = orders.map(o => `#${o.txNumber ?? o.orderCode} — ${o.item?.name || o.type} — ${money(o.amountUsd)}`)
    return `📦 Most recent orders:\n\n${lines.join('\n')}`
  }

  return null
}
