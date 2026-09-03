// Backtests for the Ethereal Telegram agent.
// Runs entirely against a fake Ethereal API — no bot token, no network, no database.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeFakeEthereal } from './fake-ethereal.js'
import { config } from '../src/config.js'
import { buildTools } from '../src/agent/tools.js'
import { createRouter } from '../src/bot/commands.js'
import { _resetCache } from '../src/database/db.js'
import { _resetRateLimit } from '../src/bot/auth.js'
import { checkPending } from '../src/notifications/orders.js'
import { sendDailyBrief, isBriefDue, formatDailyBrief } from '../src/notifications/dailyBrief.js'
import { readActions } from '../src/database/db.js'

const G = s => `\x1b[32m${s}\x1b[0m`
const R = s => `\x1b[31m${s}\x1b[0m`
const Y = s => `\x1b[33m${s}\x1b[0m`

let passed = 0, failed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    console.log(`${G('✓ PASS')} ${name}`)
    passed++
  } catch (e) {
    console.log(`${R('✗ FAIL')} ${name}`)
    console.log(`        ${R(e.message)}`)
    failed++
    failures.push({ name, error: e.message })
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg) }
function includes(haystack, needle, msg) {
  assert(String(haystack).includes(needle), `${msg || 'missing text'}\n        expected to contain: ${JSON.stringify(needle)}\n        got: ${JSON.stringify(String(haystack).slice(0, 400))}`)
}

const OWNER = 555001
const STRANGER = 999999

// Isolate agent state in a temp dir so tests never touch real data.
function freshEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eth-agent-'))
  config.dataDir = dir
  config.telegram.allowedUserIds = [String(OWNER)]
  config.ai.apiKey = '' // exercise the deterministic path by default
  config.notify.pollSeconds = 0
  config.dailyBrief = { hour: 9, minute: 0, catchUpHours: 6 } // tests mutate this; reset each time
  _resetCache()
  _resetRateLimit()
  const { client, state } = makeFakeEthereal()
  const tools = buildTools({ deps: { client } })
  const router = createRouter({ tools, cfg: config, botUsername: BOT })
  return { dir, client, state, tools, router }
}

const BOT = 'EtherealDashboard_bot'
// A 1:1 DM — the bot answers everything here.
const msg = (text, from = OWNER) => ({ from: { id: from }, chat: { id: from, type: 'private' }, text })
// A group chat — the bot only answers when addressed.
const group = (text, from = OWNER, extra = {}) => ({ from: { id: from }, chat: { id: -100123, type: 'supergroup' }, text, ...extra })
const ask = (text, from = OWNER) => msg(text, from)

console.log(`\n\x1b[1mEthereal Agent backtest\x1b[0m — fake API, no network\n`)

// ---------- auth ----------
await test('unauthorized user is denied and learns nothing', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/earnings', STRANGER))
  assert(res.text === 'Not available.', `expected generic denial, got: ${res.text}`)
  assert(!/ethereal/i.test(res.text), 'denial message must not reveal the product')
})

await test('authorized user reaches commands', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/start'))
  includes(res.text, '/earnings')
  includes(res.text, '/fulfill')
})

await test('per-user rate limit engages', async () => {
  const { router } = freshEnv()
  let limited = null
  for (let i = 0; i < 40; i++) {
    const r = await router.handleMessage(msg('/start'))
    if (r.text.startsWith('⏳')) { limited = r.text; break }
  }
  assert(limited, 'expected a rate-limit response within 40 rapid commands')
})

// ---------- read-only ----------
await test('/earnings reports real computed figures', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/earnings'))
  includes(res.text, '💰 Ethereal Earnings')
  // Paid orders: $15 + $25 today, $40 yesterday, $20 nine days ago.
  //   today = 15 + 25            = $40
  //   week  = 15 + 25 + 40       = $80  (the 9-day-old $20 falls outside)
  //   month = 15 + 25            = $40  (yesterday is in the previous calendar month)
  includes(res.text, 'Today: $40.00')
  includes(res.text, 'This Week: $80.00')
  includes(res.text, '📈 Analysis')
})

await test('/earnings analysis counts pending fulfillment correctly', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/earnings'))
  includes(res.text, '1 order awaiting fulfillment')
})

await test('/orders lists orders with status icons', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/orders'))
  includes(res.text, '#1042')
  includes(res.text, 'Roblox Toy Code')
  includes(res.text, '$15.00')
})

await test('/orders pending shows only unfulfilled toy codes', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/orders pending'))
  includes(res.text, '#1042')
  assert(!res.text.includes('#1041'), 'fulfilled order must not appear under pending')
  assert(!res.text.includes('#1040'), 'non-toycode order must not appear under pending')
})

await test('/order <id> returns detail without leaking full customer id', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/order 1042'))
  includes(res.text, '📦 Order #1042')
  includes(res.text, 'Not fulfilled')
  assert(!res.text.includes('123456789012345678'), 'full Discord id must not be exposed')
  includes(res.text, '…5678')
})

await test('/order for a missing order says so', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/order 9999'))
  includes(res.text, 'not found')
})

// ---------- fulfillment safety ----------
await test('/fulfill rejects a non-existent order', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/fulfill 9999 ABCD-EFGH'))
  includes(res.text, 'does not exist')
})

await test('/fulfill rejects a non-toy-code order', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/fulfill 1040 ABCD-EFGH'))
  includes(res.text, 'not a Toy Code')
})

await test('/fulfill rejects an unpaid order', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/fulfill 1039 ABCD-EFGH'))
  includes(res.text, 'not paid')
})

await test('/fulfill rejects an already-fulfilled order', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/fulfill 1041 ABCD-EFGH'))
  includes(res.text, 'already fulfilled')
})

await test('/fulfill requires a code', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/fulfill 1042'))
  includes(res.text, 'Usage:')
})

await test('/fulfill only STAGES — it performs no write', async () => {
  const { router, state } = freshEnv()
  const res = await router.handleMessage(msg('/fulfill 1042 ABCD-EFGH-IJKL'))
  includes(res.text, '⚠️ Confirm Fulfillment')
  includes(res.text, '/confirm 1042')
  assert(state.fulfillCalls.length === 0, 'no fulfillment write may happen before /confirm')
  assert(state.pending.length === 1, 'order must still be pending after /fulfill')
})

await test('/confirm without staging is refused', async () => {
  const { router, state } = freshEnv()
  const res = await router.handleMessage(msg('/confirm 1042'))
  includes(res.text, 'Fulfillment Failed')
  includes(res.text, 'Nothing staged')
  assert(state.fulfillCalls.length === 0, 'must not write')
})

await test('/confirm with a mismatched order number is refused', async () => {
  const { router, state } = freshEnv()
  await router.handleMessage(msg('/fulfill 1042 ABCD-EFGH-IJKL'))
  const res = await router.handleMessage(msg('/confirm 1041'))
  includes(res.text, 'Fulfillment Failed')
  assert(state.fulfillCalls.length === 0, 'mismatched confirm must not write')
})

await test('full happy path: /fulfill then /confirm delivers the code', async () => {
  const { router, state } = freshEnv()
  await router.handleMessage(msg('/fulfill 1042 ABCD-EFGH-IJKL'))
  const res = await router.handleMessage(msg('/confirm 1042'))
  includes(res.text, '✅ Order Fulfilled')
  includes(res.text, '#1042')
  assert(state.fulfillCalls.length === 1, 'exactly one write expected')
  assert(state.fulfillCalls[0].code === 'ABCD-EFGH-IJKL', 'the typed code must be delivered verbatim')
  assert(state.fulfillCalls[0].orderCode === 'AB12CD', 'must resolve txNumber → orderCode')
  assert(state.fulfillCalls[0].toycodeId === 'tc1', 'must resolve the toycode id')
})

await test('a confirmed order cannot be fulfilled twice', async () => {
  const { router, state } = freshEnv()
  await router.handleMessage(msg('/fulfill 1042 ABCD-EFGH-IJKL'))
  await router.handleMessage(msg('/confirm 1042'))
  const again = await router.handleMessage(msg('/fulfill 1042 ZZZZ-ZZZZ'))
  includes(again.text, 'already fulfilled')
  assert(state.fulfillCalls.length === 1, 'second attempt must not write')
})

await test('API failure is reported as failure, never as success', async () => {
  const { router, state } = freshEnv()
  await router.handleMessage(msg('/fulfill 1042 ABCD-EFGH-IJKL'))
  state.failFulfillWith = 'Ethereal exploded'
  const res = await router.handleMessage(msg('/confirm 1042'))
  includes(res.text, '❌ Fulfillment Failed')
  includes(res.text, 'No further action was taken')
  assert(!res.text.includes('✅'), 'must not claim success')
})

await test('staged fulfillment is scoped to the operator who staged it', async () => {
  const { router, tools } = freshEnv()
  config.telegram.allowedUserIds = [String(OWNER), '777002']
  await router.handleMessage(msg('/fulfill 1042 ABCD-EFGH-IJKL', OWNER))
  const res = await router.handleMessage(msg('/confirm 1042', 777002))
  includes(res.text, 'Fulfillment Failed')
})

// ---------- natural language (no AI key) ----------
await test('natural language: "how much did I make today?"', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(ask('how much did I make today?'))
  includes(res.text, '$40.00')
})

await test('natural language: "which orders need fulfillment?"', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(ask('which orders need fulfillment?'))
  includes(res.text, 'need fulfillment')
  includes(res.text, 'AB12CD')
})

// ---------- DM: answers everything ----------
await test('in a DM, plain questions need no mention', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('how much did I make today?'))
  assert(res !== null, 'a DM must be answered without a mention')
  includes(res.text, '$40.00')
})

await test('in a DM, commands work with no mention', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/earnings'))
  includes(res.text, '💰 Ethereal Earnings')
})

// ---------- group: only when spoken to ----------
await test('in a group, plain chatter gets no reply at all', async () => {
  const { router } = freshEnv()
  for (const chatter of ['hey', 'lol that sale was crazy', 'how much did I make today?', 'ok cool']) {
    const res = await router.handleMessage(group(chatter))
    assert(res === null, `expected silence for "${chatter}", got: ${JSON.stringify(res)}`)
  }
})

await test('in a group, @mention wakes the bot', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(group(`@${BOT} how much did I make today?`))
  assert(res !== null, 'mention must get a reply')
  includes(res.text, '$40.00')
})

await test('in a group, @mention is case-insensitive and works mid-sentence', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(group('hey @etherealdashboard_bot which orders need fulfillment?'))
  assert(res !== null, 'mention must be recognised regardless of case or position')
  includes(res.text, 'need fulfillment')
})

await test('in a group, replying to the bot counts as addressing it', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(group('how much did I make today?', OWNER, {
    reply_to_message: { from: { id: 1, is_bot: true } },
  }))
  assert(res !== null, 'a reply to the bot must get an answer')
  includes(res.text, '$40.00')
})

await test('in a group, commands work without a mention', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(group('/earnings'))
  includes(res.text, '💰 Ethereal Earnings')
})

await test('group-style /command@botname still works', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(group(`/earnings@${BOT}`))
  includes(res.text, '💰 Ethereal Earnings')
})

await test('a bare @mention returns help rather than nothing', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(group(`@${BOT}`))
  includes(res.text, '/earnings')
})

await test('in a group, a stranger chatting is silently ignored', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(group('what is this bot', STRANGER))
  assert(res === null, 'strangers get silence unless they address the bot directly')
})

await test('a stranger who DMs or @mentions gets only a generic denial', async () => {
  const { router } = freshEnv()
  const dmRes = await router.handleMessage(msg('/earnings', STRANGER))
  assert(dmRes.text === 'Not available.', `DM: expected generic denial, got: ${dmRes.text}`)
  const groupRes = await router.handleMessage(group(`@${BOT} /earnings`, STRANGER))
  assert(groupRes.text === 'Not available.', `group: expected generic denial, got: ${groupRes.text}`)
})

await test('a message with no chat.type defaults to group (quiet) behaviour', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage({ from: { id: OWNER }, chat: { id: OWNER }, text: 'hello there' })
  assert(res === null, 'unknown chat type must fall back to the safer quiet behaviour')
})

// ---------- notifications ----------
await test('pending watcher notifies once, then dedupes', async () => {
  const { tools } = freshEnv()
  const sent = []
  const send = async (uid, text) => sent.push({ uid, text })

  const first = await checkPending({ tools, send, cfg: config })
  assert(first.notified === 1, `expected 1 notification, got ${first.notified}`)
  includes(sent[0].text, 'New Order Requires Fulfillment')
  includes(sent[0].text, '/fulfill 1042')

  const second = await checkPending({ tools, send, cfg: config })
  assert(second.notified === 0, 'must not re-notify the same order')
  assert(sent.length === 1, 'exactly one message total')
})

await test('an undeliverable notice is retried, not silently dropped', async () => {
  const { tools } = freshEnv()
  // Mirrors Telegram's real "chat not found" before the operator opens the chat.
  const failing = async () => { throw new Error('Bad Request: chat not found') }
  const first = await checkPending({ tools, send: failing, cfg: config })
  assert(first.notified === 0, 'nothing was delivered, so nothing should count as notified')
  assert(first.failed === 1, 'the failure should be reported')

  // Once delivery works, the order must still be waiting for us.
  const sent = []
  const ok = async (uid, text) => sent.push({ uid, text })
  const second = await checkPending({ tools, send: ok, cfg: config })
  assert(second.notified === 1, 'the order must be retried once delivery succeeds')
  includes(sent[0].text, 'New Order Requires Fulfillment')
})

// ---------- morning brief ----------
const at = (h, m = 0, dayOffset = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d
}

await test('morning brief contains revenue and the orders to fulfill', async () => {
  const { tools } = freshEnv()
  const sent = []
  const res = await sendDailyBrief({ tools, send: async (u, t) => sent.push({ u, t }), cfg: config })
  assert(res.delivered, 'expected delivery')
  const text = sent[0].t
  includes(text, '🌅 Good morning')
  includes(text, '💰 Revenue')
  includes(text, 'This week: $80.00')
  includes(text, '📦 To fulfill')
  includes(text, '#1042')            // resolved to the human order number
  includes(text, '/fulfill 1042')    // copy-pasteable
  assert(sent[0].u === String(OWNER), 'must DM the owner')
})

await test('morning brief compares yesterday vs the day before, not vs a barely-started today', async () => {
  const { tools } = freshEnv()
  // Sales only on the day before yesterday → yesterday is a real 100% drop, and
  // "today" (empty this early) must not be what drives the comparison.
  const earnings = await tools.get_earnings()
  const withHistory = {
    ...earnings,
    revenue: { ...earnings.revenue, yesterday: 50, dayBefore: 100, today: 0 },
    yesterdayChangePct: -50,
    dayChangePct: -100, // if the brief used this, it would read "down 100%" every morning
  }
  const text = formatDailyBrief(withHistory, [])
  includes(text, 'down 50%')
  assert(!text.includes('100%'), 'must not report the today-vs-yesterday figure in a morning brief')
})

await test('morning brief omits the change line when flat', async () => {
  const { tools } = freshEnv()
  const e = await tools.get_earnings()
  const text = formatDailyBrief({ ...e, yesterdayChangePct: 0 }, [])
  assert(!/up 0%|down 0%/.test(text), 'a 0% change line is noise and should be omitted')
})

await test('morning brief says so when nothing is pending', async () => {
  const { tools, state } = freshEnv()
  state.pending = []
  const sent = []
  await sendDailyBrief({ tools, send: async (u, t) => sent.push({ u, t }), cfg: config })
  includes(sent[0].t, 'all caught up')
})

await test('brief is due at the scheduled hour, not before', async () => {
  freshEnv()
  config.dailyBrief = { hour: 9, minute: 0, catchUpHours: 6 }
  assert(isBriefDue(at(9, 0), config) === true, 'should be due at 09:00')
  assert(isBriefDue(at(9, 30), config) === true, 'should be due at 09:30')
  assert(isBriefDue(at(8, 59), config) === false, 'must NOT fire before the scheduled time')
})

await test('brief is sent at most once per day', async () => {
  const { tools } = freshEnv()
  config.dailyBrief = { hour: 9, minute: 0, catchUpHours: 6 }
  const sent = []
  const send = async (u, t) => sent.push({ u, t })

  assert(isBriefDue(at(9, 5), config) === true, 'first check should be due')
  await sendDailyBrief({ tools, send, cfg: config, now: at(9, 5) })
  assert(isBriefDue(at(9, 6), config) === false, 'must not re-send the same day')
  assert(isBriefDue(at(11, 0), config) === false, 'still not later the same day')
  assert(sent.length === 1, `expected exactly 1 brief, got ${sent.length}`)
})

await test('a machine asleep at 9am still gets the brief on wake (catch-up)', async () => {
  freshEnv()
  config.dailyBrief = { hour: 9, minute: 0, catchUpHours: 6 }
  assert(isBriefDue(at(13, 0), config) === true, 'within the catch-up window it should still fire')
})

await test('a late-night start does NOT fire a stale brief', async () => {
  freshEnv()
  config.dailyBrief = { hour: 9, minute: 0, catchUpHours: 6 }
  assert(isBriefDue(at(23, 30), config) === false, 'past the catch-up window it must stay silent')
})

await test('undelivered brief is retried rather than marked done', async () => {
  const { tools } = freshEnv()
  config.dailyBrief = { hour: 9, minute: 0, catchUpHours: 6 }
  const failing = async () => { throw new Error('chat not found') }
  const res = await sendDailyBrief({ tools, send: failing, cfg: config, now: at(9, 5) })
  assert(res.delivered === false, 'delivery should report failure')
  assert(isBriefDue(at(9, 10), config) === true, 'a failed brief must remain due, not be swallowed')
})

await test('DAILY_BRIEF_HOUR=-1 disables the brief entirely', async () => {
  freshEnv()
  config.dailyBrief = { hour: -1, minute: 0, catchUpHours: 6 }
  assert(isBriefDue(at(9, 0), config) === false, 'disabled means never due')
})

await test('/brief returns the same content on demand', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/brief'))
  includes(res.text, '🌅 Good morning')
  includes(res.text, '/fulfill 1042')
})

await test('/brief on demand does not consume the once-a-day slot', async () => {
  const { router } = freshEnv()
  config.dailyBrief = { hour: 9, minute: 0, catchUpHours: 6 }
  await router.handleMessage(msg('/brief'))
  assert(isBriefDue(at(9, 5), config) === true, 'manual /brief must not suppress the scheduled one')
})

// ---------- dashboard ----------
await test('/dashboard renders a real PNG', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/dashboard'))
  assert(res.photo, 'expected a photo buffer')
  const sig = res.photo.subarray(0, 8)
  assert(sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47, 'buffer is not a PNG')
  assert(res.photo.length > 2000, `PNG suspiciously small (${res.photo.length} bytes)`)
  includes(res.caption, 'Ethereal Dashboard')
})

await test('/dashboard sections each render', async () => {
  const { router } = freshEnv()
  for (const section of ['earnings', 'orders', 'analytics']) {
    const res = await router.handleMessage(msg(`/dashboard ${section}`))
    assert(res.photo && res.photo.length > 2000, `${section} did not render`)
  }
})

// ---------- logging / secrets ----------
await test('audit log records actions but never the toy code', async () => {
  const { router } = freshEnv()
  await router.handleMessage(msg('/fulfill 1042 SECRET-CODE-9999'))
  await router.handleMessage(msg('/confirm 1042'))
  const log = readActions(50)
  const raw = JSON.stringify(log)
  assert(log.some(l => l.action === 'confirm_fulfillment' && l.result === 'ok'), 'expected a successful confirm entry')
  assert(!raw.includes('SECRET-CODE-9999'), 'the toy code must never be written to the audit log')
})

await test('denied attempts are logged', async () => {
  const { router } = freshEnv()
  await router.handleMessage(msg('/earnings', STRANGER))
  const log = readActions(50)
  assert(log.some(l => l.result === 'denied'), 'expected a denied entry in the audit log')
})

await test('unknown command is handled gracefully', async () => {
  const { router } = freshEnv()
  const res = await router.handleMessage(msg('/nonsense'))
  includes(res.text, 'Unknown command')
})

// ---------- summary ----------
console.log('\n' + '─'.repeat(52))
if (failed === 0) {
  console.log(`${G(`${passed} passed`)}  0 failed`)
} else {
  console.log(`${G(`${passed} passed`)}  ${R(`${failed} failed`)}`)
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ${R('•')} ${f.name}\n    ${f.error}`)
}
console.log('')
process.exit(failed === 0 ? 0 : 1)
