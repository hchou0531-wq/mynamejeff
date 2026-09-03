#!/usr/bin/env node
/**
 * Backtest / smoke-test suite for the Ethereal API.
 *
 *   node scripts/backtest.mjs            # against http://localhost:3000
 *   BASE=https://your-tunnel.example node scripts/backtest.mjs
 *
 * Covers the failure modes that have actually bitten this app:
 *  - DB outage must return 503 + dbUnavailable (never an opaque 500, never a 30s hang)
 *  - auth, CAPTCHA single-use, rate limiting, chat ownership, admin authorization
 * Exits non-zero if anything fails, so it can gate a deploy.
 */
const BASE = process.env.BASE || 'http://localhost:3000'

let pass = 0, fail = 0, skip = 0
const failures = []

const c = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[90m${s}\x1b[0m` }

async function req(path, { method = 'GET', body, token, headers = {} } = {}) {
  const started = Date.now()
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = {}
  try { data = await res.json() } catch {}
  return { status: res.status, data, ms: Date.now() - started, headers: res.headers }
}

async function test(name, fn) {
  try {
    const r = await fn()
    if (r === 'skip') { skip++; console.log(`${c.y('○ SKIP')} ${name}`); return }
    pass++; console.log(`${c.g('✓ PASS')} ${name}`)
  } catch (e) {
    fail++; failures.push({ name, message: e.message })
    console.log(`${c.r('✗ FAIL')} ${name}\n       ${c.d(e.message)}`)
  }
}
function expect(cond, msg) { if (!cond) throw new Error(msg) }
function eq(actual, want, label) {
  if (actual !== want) throw new Error(`${label}: expected ${want}, got ${actual}`)
}
const rand = () => Math.random().toString(36).slice(2, 10)

// Solve the self-hosted CAPTCHA by reading the digits back out of the SVG it returns.
// (Only possible because we're the trusted test harness hitting our own endpoint.)
async function solveCaptcha() {
  const { status, data } = await req('/captcha/new')
  if (status !== 200) return null
  const chars = [...data.svg.matchAll(/>([^<]+)<\/text>/g)].map(m => m[1]).join('').trim()
  const m = chars.match(/^(\d+)\s*([+-])\s*(\d+)$/)
  if (!m) throw new Error(`could not parse captcha question from svg: "${chars}"`)
  const [, a, op, b] = m
  const answer = op === '+' ? Number(a) + Number(b) : Number(a) - Number(b)
  return { captchaId: data.captchaId, captchaAnswer: answer }
}

const run = async () => {
  console.log(`\n${c.d('Ethereal API backtest →')} ${BASE}\n`)

  // ---- Reachability + the DB-outage contract -------------------------------
  let dbUp = true
  const cfg = await req('/config')

  await test('server responds to /config (no hang, no crash)', async () => {
    expect([200, 503].includes(cfg.status), `unexpected status ${cfg.status}`)
    expect(cfg.ms < 15000, `took ${cfg.ms}ms — should fail fast, not hang`)
  })

  if (cfg.status === 503) {
    dbUp = false
    await test('DB outage returns 503 + dbUnavailable (not an opaque 500)', async () => {
      eq(cfg.status, 503, 'status')
      expect(cfg.data.dbUnavailable === true, 'missing dbUnavailable flag')
      expect(!/internal server error/i.test(cfg.data.error || ''), 'still shows generic internal error text')
    })
    await test('DB outage fails fast (<10s, not the old 30s hang)', async () => {
      expect(cfg.ms < 10000, `took ${cfg.ms}ms`)
    })
    await test('DB outage is retryable — a second call still answers 503, not a cached dead promise', async () => {
      const again = await req('/config')
      eq(again.status, 503, 'status on retry')
      expect(again.ms < 10000, `retry took ${again.ms}ms`)
    })
    console.log(`\n${c.y('Database is DOWN — ran outage-contract tests only.')}`)
    console.log(`${c.y('Re-run once Atlas is reachable to exercise the full suite.')}\n`)
  }

  // ---- Everything below needs a live DB ------------------------------------
  const needDb = fn => async () => (dbUp ? fn() : 'skip')

  await test('public endpoints return 200', needDb(async () => {
    for (const p of ['/config', '/listings?sort=newest', '/sold', '/toycodes', '/reviews']) {
      const r = await req(p)
      eq(r.status, 200, `GET ${p}`)
    }
  }))

  await test('unknown route returns 404 (not 500)', needDb(async () => {
    const r = await req('/definitely-not-a-route-' + rand())
    eq(r.status, 404, 'status')
  }))

  await test('CAPTCHA issues a solvable challenge', needDb(async () => {
    const s = await solveCaptcha()
    expect(s && s.captchaId, 'no captcha returned')
    expect(Number.isFinite(s.captchaAnswer), 'unsolvable answer')
  }))

  await test('signup rejects a wrong CAPTCHA', needDb(async () => {
    const s = await solveCaptcha()
    const r = await req('/auth/signup', { method: 'POST', body: {
      username: 'bt' + rand(), email: `bt${rand()}@test.local`, password: 'TestPass123!',
      captchaId: s.captchaId, captchaAnswer: s.captchaAnswer + 1,
    }})
    eq(r.status, 400, 'status')
    expect(/captcha/i.test(r.data.error || ''), `expected captcha error, got "${r.data.error}"`)
  }))

  await test('CAPTCHA is single-use (replay is rejected)', needDb(async () => {
    const s = await solveCaptcha()
    const first = await req('/auth/signup', { method: 'POST', body: {
      username: 'bt' + rand(), email: `bt${rand()}@test.local`, password: 'TestPass123!', ...s,
    }})
    eq(first.status, 200, 'first use should succeed')
    const replay = await req('/auth/signup', { method: 'POST', body: {
      username: 'bt' + rand(), email: `bt${rand()}@test.local`, password: 'TestPass123!', ...s,
    }})
    eq(replay.status, 400, 'replayed captcha should be rejected')
  }))

  // A real account for the authenticated checks below.
  let token = null, userEmail = `bt${rand()}@test.local`
  await test('signup with a valid CAPTCHA succeeds and returns a token', needDb(async () => {
    const s = await solveCaptcha()
    const r = await req('/auth/signup', { method: 'POST', body: {
      username: 'bt' + rand(), email: userEmail, password: 'TestPass123!', ...s,
    }})
    eq(r.status, 200, 'status')
    expect(r.data.token, 'no token returned')
    expect(r.data.user && r.data.user.password === undefined, 'password leaked in response')
    expect(r.data.user && r.data.user.totpSecret === undefined, 'totpSecret leaked in response')
    token = r.data.token
  }))

  await test('login works and never leaks secrets', needDb(async () => {
    if (!token) return 'skip'
    const s = await solveCaptcha()
    const r = await req('/auth/login', { method: 'POST', body: { email: userEmail, password: 'TestPass123!', ...s } })
    eq(r.status, 200, 'status')
    expect(r.data.user.password === undefined, 'password leaked')
    expect(r.data.user.totpSecret === undefined, 'totpSecret leaked')
  }))

  await test('login rejects a wrong password', needDb(async () => {
    if (!token) return 'skip'
    const s = await solveCaptcha()
    const r = await req('/auth/login', { method: 'POST', body: { email: userEmail, password: 'wrong-password', ...s } })
    expect([400, 401, 429].includes(r.status), `expected 401, got ${r.status}`)
  }))

  await test('NoSQL operator injection cannot bypass login', needDb(async () => {
    const s = await solveCaptcha()
    const r = await req('/auth/login', { method: 'POST', body: { email: { $ne: null }, password: { $ne: null }, ...s } })
    expect(r.status !== 200, 'operator injection returned a session!')
  }))

  await test('/me requires a valid token', needDb(async () => {
    const anon = await req('/me')
    eq(anon.status, 401, 'anonymous status')
    const bad = await req('/me', { token: 'not-a-real-token' })
    eq(bad.status, 401, 'bogus-token status')
  }))

  await test('admin routes reject non-admin callers', needDb(async () => {
    if (!token) return 'skip'
    for (const p of ['/admin/stats', '/admin/users', '/admin/chat/threads']) {
      const anon = await req(p)
      expect([401, 403].includes(anon.status), `${p} anonymous → ${anon.status}`)
      const asUser = await req(p, { token })
      eq(asUser.status, 403, `${p} as normal user`)
    }
  }))

  await test('free-item exploit is closed (demo purchase is admin-only)', needDb(async () => {
    if (!token) return 'skip'
    const list = await req('/toycodes')
    if (!list.data.toycodes || !list.data.toycodes.length) return 'skip'
    const id = list.data.toycodes[0].id
    const r = await req(`/toycodes/${id}/order`, { method: 'POST', body: {
      discordName: 'backtest', discordId: '123456789012345678', demo: true,
    }, token })
    if (r.status === 200) {
      expect(r.data.checkoutUrl, 'non-admin got a free item without a payment link!')
    }
  }))

  // ---- Chat ownership -------------------------------------------------------
  let threadId = null
  const guestA = 'backtest-guest-' + rand()
  await test('guest chat requires a CAPTCHA to open a new thread', needDb(async () => {
    const r = await req('/chat/start', { method: 'POST', body: { guestId: guestA } })
    eq(r.status, 400, 'status')
    expect(/captcha/i.test(r.data.error || ''), `expected captcha error, got "${r.data.error}"`)
  }))

  await test('guest chat opens after solving the CAPTCHA', needDb(async () => {
    const s = await solveCaptcha()
    const r = await req('/chat/start', { method: 'POST', body: { guestId: guestA, ...s } })
    eq(r.status, 200, 'status')
    expect(r.data.threadId, 'no threadId')
    threadId = r.data.threadId
  }))

  await test('repeat /chat/start is idempotent (no duplicate threads)', needDb(async () => {
    if (!threadId) return 'skip'
    const results = await Promise.all([
      req('/chat/start', { method: 'POST', body: { guestId: guestA } }),
      req('/chat/start', { method: 'POST', body: { guestId: guestA } }),
      req('/chat/start', { method: 'POST', body: { guestId: guestA } }),
    ])
    for (const r of results) {
      eq(r.status, 200, 'resuming an existing thread should not need a captcha')
      eq(r.data.threadId, threadId, 'got a different threadId — duplicate thread created')
    }
  }))

  await test('another guest cannot read your chat thread (IDOR)', needDb(async () => {
    if (!threadId) return 'skip'
    const r = await req(`/chat/${threadId}/messages?guestId=someone-else-${rand()}`)
    eq(r.status, 403, 'status')
  }))

  await test('another guest cannot post into your chat thread', needDb(async () => {
    if (!threadId) return 'skip'
    const r = await req(`/chat/${threadId}/messages`, { method: 'POST', body: { text: 'hijack', guestId: 'someone-else-' + rand() } })
    eq(r.status, 403, 'status')
  }))

  // ---- Rate limiting --------------------------------------------------------
  await test('signup is rate limited (429 with Retry-After)', needDb(async () => {
    let got429 = false, retryAfter = null
    for (let i = 0; i < 10; i++) {
      const r = await req('/auth/signup', { method: 'POST', body: {
        username: 'rl' + rand(), email: `rl${rand()}@test.local`, password: 'TestPass123!',
        captchaId: 'deliberately-invalid', captchaAnswer: 0,
      }})
      if (r.status === 429) { got429 = true; retryAfter = r.headers.get('retry-after'); break }
    }
    expect(got429, 'never hit the signup rate limit after 10 attempts')
    expect(retryAfter, '429 response is missing a Retry-After header')
  }))

  console.log(`\n${'─'.repeat(52)}`)
  console.log(`${c.g(`${pass} passed`)}  ${fail ? c.r(`${fail} failed`) : '0 failed'}  ${skip ? c.y(`${skip} skipped`) : '0 skipped'}`)
  if (failures.length) {
    console.log(`\n${c.r('Failures:')}`)
    for (const f of failures) console.log(`  • ${f.name}\n    ${c.d(f.message)}`)
  }
  console.log()
  process.exit(fail ? 1 : 0)
}

run().catch(e => { console.error(c.r('\nHarness crashed:'), e); process.exit(1) })
