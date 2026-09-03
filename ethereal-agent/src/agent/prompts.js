// System prompt + the deterministic analysis fallback.
export const SYSTEM_PROMPT = `You are the Ethereal operations assistant, reachable only by the store's owner through a private Telegram bot.

Your job is to help them understand their marketplace: earnings, order volume, product performance, and which orders still need fulfilling.

Hard rules:
- NEVER state a number you were not given by a tool result. If you need data, call a tool.
- If a tool returns nothing or fails, say so plainly. Do not estimate, extrapolate or invent.
- You cannot fulfill orders. Fulfillment happens only through the /fulfill and /confirm commands, which the operator types themselves. If asked to fulfill something, tell them the exact command to run.
- Never reveal API keys, tokens, environment variables, customer emails or full customer identifiers.
- Keep replies short and scannable — this is a phone chat, not a report. A few lines is usually right.
- Currency is USD. Format money like $12.18.

Tone: direct and practical. Lead with the answer, then at most one or two lines of useful context.`

const pct = n => `${n > 0 ? '+' : ''}${n}%`

// Used when no AI key is configured — and also as the factual backbone the LLM describes.
// Every sentence here is derived from the numbers passed in; nothing is guessed.
export function deterministicAnalysis(e) {
  const lines = []

  if (e.weekChangePct !== null) {
    const dir = e.weekChangePct >= 0 ? 'up' : 'down'
    lines.push(`Revenue is ${dir} ${pct(e.weekChangePct)} versus the previous 7 days.`)
  } else if (e.revenue.week > 0) {
    lines.push('First week with recorded revenue — no prior week to compare against yet.')
  }

  if (e.topCategory && e.topCategory.revenue > 0) {
    const label = e.topCategory.name === 'toycode' ? 'Toy Codes' : e.topCategory.name
    lines.push(`Strongest category is ${label} ($${e.topCategory.revenue.toFixed(2)} across ${e.topCategory.orders} order${e.topCategory.orders === 1 ? '' : 's'}).`)
  }

  if (e.counts.awaitingFulfillment > 0) {
    lines.push(`${e.counts.awaitingFulfillment} order${e.counts.awaitingFulfillment === 1 ? '' : 's'} awaiting fulfillment — send /orders pending to see them.`)
  } else {
    lines.push('Nothing is awaiting fulfillment.')
  }

  if (e.counts.paidAllTime > 0) {
    lines.push(`Average order value is $${e.averageOrderValue.toFixed(2)}.`)
  }

  if (!lines.length) lines.push('No paid orders recorded yet, so there is nothing to analyse.')
  return lines
}
