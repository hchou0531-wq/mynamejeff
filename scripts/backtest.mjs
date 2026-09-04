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

async function req(path, { method = 'GET', body, token, ip, headers = {} } = {}) {
  const started = Date.now()
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // clientIp() in the API trusts the LAST X-Forwarded-For hop (see its own comment on
      // why: a proxy appends there, so a spoofed value the client prepends is ignored). The
      // harness abuses that same trust to give independent test flows independent per-IP
      // rate-limit buckets — every request in this run otherwise shares one real IP and
      // would exhaust shared quotas (signups/hour, etc.) purely from test-suite volume,
      // not from anything the flow under test is actually doing wrong.
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = {}
  try { data = await res.json() } catch {}
  return { status: res.status, data, ms: Date.now() - started, headers: res.headers }
}
// A fresh synthetic IP per logical test flow, so it gets its own rate-limit buckets.
let ipCounter = 0
const freshIp = () => `10.77.${Math.floor(ipCounter / 254)}.${(ipCounter++ % 254) + 1}`

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

// Solve the self-hosted CAPTCHA. The glyphs are hand-drawn <line> strokes rather than an
// SVG <text> node specifically so the answer can't be scraped out of the markup — so the
// server hands the answer back directly, but ONLY when TEST_MODE=true (see the guard in
// app/api/[[...path]]/route.js and its use in scripts/test-server.mjs). Against a real
// deployment (no TEST_MODE) this legitimately can't solve the challenge, same as any client.
async function solveCaptcha(ip) {
  const { status, data } = await req('/captcha/new', { ip })
  if (status !== 200) return null
  if (typeof data.answer !== 'number') {
    throw new Error('server did not return a CAPTCHA answer — is TEST_MODE=true set on it? (scripts/test-server.mjs sets this automatically)')
  }
  return { captchaId: data.captchaId, captchaAnswer: data.answer }
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
    const s = await solveCaptcha(freshIp())
    expect(s && s.captchaId, 'no captcha returned')
    expect(Number.isFinite(s.captchaAnswer), 'unsolvable answer')
  }))

  await test('signup rejects a wrong CAPTCHA', needDb(async () => {
    const ip = freshIp()
    const s = await solveCaptcha(ip)
    const r = await req('/auth/signup', { ip, method: 'POST', body: {
      username: 'bt' + rand(), email: `bt${rand()}@test.local`, password: 'TestPass123!',
      captchaId: s.captchaId, captchaAnswer: s.captchaAnswer + 1,
    }})
    eq(r.status, 400, 'status')
    expect(/captcha/i.test(r.data.error || ''), `expected captcha error, got "${r.data.error}"`)
  }))

  await test('CAPTCHA is single-use (replay is rejected)', needDb(async () => {
    const ip = freshIp()
    const s = await solveCaptcha(ip)
    const first = await req('/auth/signup', { ip, method: 'POST', body: {
      username: 'bt' + rand(), email: `bt${rand()}@test.local`, password: 'TestPass123!', ...s,
    }})
    eq(first.status, 200, 'first use should succeed')
    const replay = await req('/auth/signup', { ip, method: 'POST', body: {
      username: 'bt' + rand(), email: `bt${rand()}@test.local`, password: 'TestPass123!', ...s,
    }})
    eq(replay.status, 400, 'replayed captcha should be rejected')
  }))

  // A real, VERIFIED account for the authenticated checks below. Signup itself no longer
  // returns a token — the account is pending until the emailed code is confirmed — so this
  // walks the full signup → capture → verify chain. The capture read only works because the
  // test harness runs with TEST_MODE=true (see scripts/test-server.mjs); that flag must
  // never be set outside this harness — see the guard in app/api/[[...path]]/route.js.
  // Each flow below gets its OWN synthetic IP (via freshIp()) purely so independent test
  // flows get independent rate-limit buckets — otherwise every request in this run shares
  // one real IP and the suite's own volume of signups would exhaust shared per-IP quotas
  // that have nothing to do with whatever the flow under test is actually checking.
  const mainIp = freshIp()
  let token = null, userEmail = `bt${rand()}@test.local`
  await test('signup succeeds but returns no token — account is pending until verified', needDb(async () => {
    const s = await solveCaptcha(mainIp)
    const r = await req('/auth/signup', { ip: mainIp, method: 'POST', body: {
      username: 'bt' + rand(), email: userEmail, password: 'TestPass123!', ...s,
    }})
    eq(r.status, 200, 'status')
    expect(r.data.token === undefined, 'signup must not hand out a session before the email is verified')
    expect(/verification code/i.test(r.data.message || ''), `expected a pending-verification message, got "${JSON.stringify(r.data)}"`)
  }))

  await test('the emailed code verifies the account and returns a session', needDb(async () => {
    const captured = await req(`/test/verification-code?email=${encodeURIComponent(userEmail)}`)
    expect(captured.status === 200 && captured.data.code, 'harness could not read back the captured code — TEST_MODE not set on the server?')
    const r = await req('/auth/verify-email', { ip: mainIp, method: 'POST', body: { email: userEmail, code: captured.data.code } })
    eq(r.status, 200, 'status')
    expect(r.data.token, 'no token returned')
    expect(r.data.user && r.data.user.emailVerified === true, 'user not marked emailVerified')
    expect(r.data.user && r.data.user.password === undefined, 'password leaked in response')
    expect(r.data.user && r.data.user.totpSecret === undefined, 'totpSecret leaked in response')
    token = r.data.token
  }))

  await test('a verification code cannot be replayed', needDb(async () => {
    if (!token) return 'skip'
    const captured = await req(`/test/verification-code?email=${encodeURIComponent(userEmail)}`)
    if (captured.status !== 200) return 'skip' // already cleaned up — fine, this just means we can't re-check
    const r = await req('/auth/verify-email', { ip: mainIp, method: 'POST', body: { email: userEmail, code: captured.data.code } })
    eq(r.status, 400, 'a second use of the same code should be rejected')
  }))

  await test('verify-email rejects a wrong code with a generic message', needDb(async () => {
    const ip = freshIp()
    const s = await solveCaptcha(ip)
    const email = `ev${rand()}@test.local`
    await req('/auth/signup', { ip, method: 'POST', body: { username: 'ev' + rand(), email, password: 'TestPass123!', ...s } })
    const r = await req('/auth/verify-email', { ip, method: 'POST', body: { email, code: '000000' } })
    eq(r.status, 400, 'status')
    expect(/invalid or expired/i.test(r.data.error || ''), `expected the generic invalid/expired message, got "${r.data.error}"`)
  }))

  await test('verify-email locks out the code after too many wrong attempts', needDb(async () => {
    const ip = freshIp()
    const s = await solveCaptcha(ip)
    const email = `ev${rand()}@test.local`
    await req('/auth/signup', { ip, method: 'POST', body: { username: 'ev' + rand(), email, password: 'TestPass123!', ...s } })
    let last
    for (let i = 0; i < 6; i++) last = await req('/auth/verify-email', { ip, method: 'POST', body: { email, code: '000000' } })
    eq(last.status, 400, 'still a generic 400 once the attempt limit is exhausted')
    const captured = await req(`/test/verification-code?email=${encodeURIComponent(email)}`)
    if (captured.status === 200) {
      const withRealCode = await req('/auth/verify-email', { ip, method: 'POST', body: { email, code: captured.data.code } })
      eq(withRealCode.status, 400, 'even the CORRECT code must be rejected once the attempt limit is hit')
    }
  }))

  await test('signup gives the identical response whether or not the email is already registered', needDb(async () => {
    const ip = freshIp()
    const email = `ev${rand()}@test.local`
    const s1 = await solveCaptcha(ip)
    const first = await req('/auth/signup', { ip, method: 'POST', body: { username: 'ev' + rand(), email, password: 'TestPass123!', ...s1 } })
    const s2 = await solveCaptcha(ip)
    const second = await req('/auth/signup', { ip, method: 'POST', body: { username: 'ev' + rand(), email, password: 'TestPass123!', ...s2 } })
    eq(first.status, 200, 'first signup status')
    eq(second.status, 200, 'repeat signup status')
    eq(second.data.message, first.data.message, 'response text differs — leaks whether the email is already registered')
  }))

  // Regression: the username check used to run BEFORE the email check, so a user who
  // abandoned their own signup and started over — same username, same email — was told
  // "Username is already taken" and had no route left to a fresh code.
  await test('retrying an abandoned signup with the same username and email is not rejected', needDb(async () => {
    const ip = freshIp()
    const email = `ev${rand()}@test.local`
    const username = 'ev' + rand()
    const s1 = await solveCaptcha(ip)
    const first = await req('/auth/signup', { ip, method: 'POST', body: { username, email, password: 'TestPass123!', ...s1 } })
    eq(first.status, 200, 'first signup status')
    const s2 = await solveCaptcha(ip)
    const retry = await req('/auth/signup', { ip, method: 'POST', body: { username, email, password: 'TestPass123!', ...s2 } })
    eq(retry.status, 200, 'retrying your own abandoned signup should not 400')
    expect(!/username/i.test(retry.data.error || ''), `dead-ended on a username collision: "${retry.data.error}"`)
    eq(retry.data.message, first.data.message, 'retry should be indistinguishable from the first attempt')
  }))

  await test('a username taken by a DIFFERENT email is still rejected', needDb(async () => {
    const ip = freshIp()
    const username = 'ev' + rand()
    const s1 = await solveCaptcha(ip)
    await req('/auth/signup', { ip, method: 'POST', body: { username, email: `ev${rand()}@test.local`, password: 'TestPass123!', ...s1 } })
    const s2 = await solveCaptcha(ip)
    const other = await req('/auth/signup', { ip, method: 'POST', body: { username, email: `ev${rand()}@test.local`, password: 'TestPass123!', ...s2 } })
    eq(other.status, 400, 'status')
    expect(/username/i.test(other.data.error || ''), `expected a username-taken error, got "${JSON.stringify(other.data)}"`)
  }))

  await test('resend-verification enforces the cooldown right after signup', needDb(async () => {
    const ip = freshIp()
    const s = await solveCaptcha(ip)
    const email = `ev${rand()}@test.local`
    await req('/auth/signup', { ip, method: 'POST', body: { username: 'ev' + rand(), email, password: 'TestPass123!', ...s } })
    const r = await req('/auth/resend-verification', { ip, method: 'POST', body: { email } })
    eq(r.status, 429, 'expected the 60s cooldown to still be active immediately after signup')
    expect(r.headers.get('retry-after'), '429 response is missing a Retry-After header')
  }))

  await test('resend-verification gives the same generic response for an unregistered email', needDb(async () => {
    const r = await req('/auth/resend-verification', { ip: freshIp(), method: 'POST', body: { email: `nobody${rand()}@test.local` } })
    eq(r.status, 200, 'status')
    expect(/pending verification/i.test(r.data.message || ''), `expected the generic message, got "${JSON.stringify(r.data)}"`)
  }))

  // This used to assert the OPPOSITE ("unverified accounts can log in"), which is how the
  // bypass survived: login minted a real session for an unverified account and the test
  // pinned that in place. The browser dropped the token, but nothing else had to. Only the
  // two purchase routes re-checked emailVerified, so that token was accepted everywhere
  // else. The invariant worth testing is that no token is issued at all.
  await test('login issues NO session token for an unverified account', needDb(async () => {
    const ip = freshIp()
    const s = await solveCaptcha(ip)
    const email = `ev${rand()}@test.local`
    await req('/auth/signup', { ip, method: 'POST', body: { username: 'ev' + rand(), email, password: 'TestPass123!', ...s } })
    const s2 = await solveCaptcha(ip)
    const login = await req('/auth/login', { ip, method: 'POST', body: { email, password: 'TestPass123!', ...s2 } })
    eq(login.status, 200, 'the client routes this into the code-entry step, so it must stay 2xx')
    eq(login.data.user.emailVerified, false, 'account should not be verified yet')
    expect(login.data.requiresVerification === true, 'missing requiresVerification flag')
    expect(!login.data.token, `a session token was issued to an UNVERIFIED account: ${login.data.token}`)
    // Belt and braces: whatever the response carried, it must not authenticate anything.
    const me = await req('/me', { ip, token: login.data.token })
    eq(me.status, 401, 'an unverified login response must not authenticate /me')
  }))

  await test('an unverified account is blocked from purchasing', needDb(async () => {
    const list = await req('/listings')
    if (!list.data.listings || !list.data.listings.length) return 'skip'
    const ip = freshIp()
    const s = await solveCaptcha(ip)
    const email = `ev${rand()}@test.local`
    await req('/auth/signup', { ip, method: 'POST', body: { username: 'ev' + rand(), email, password: 'TestPass123!', ...s } })
    // No token is obtainable without verifying, which is itself the strongest form of this
    // guarantee — assert the route's own check too, in case a token ever leaks another way.
    const r = await req('/orders', { ip, method: 'POST', body: { listingId: list.data.listings[0].id } })
    expect([401, 403].includes(r.status), `an unverified/anonymous caller should not be able to purchase, got ${r.status}`)
  }))

  await test('login works and never leaks secrets', needDb(async () => {
    if (!token) return 'skip'
    const s = await solveCaptcha(mainIp)
    const r = await req('/auth/login', { ip: mainIp, method: 'POST', body: { email: userEmail, password: 'TestPass123!', ...s } })
    eq(r.status, 200, 'status')
    expect(r.data.user.password === undefined, 'password leaked')
    expect(r.data.user.totpSecret === undefined, 'totpSecret leaked')
  }))

  await test('login rejects a wrong password', needDb(async () => {
    if (!token) return 'skip'
    const s = await solveCaptcha(mainIp)
    const r = await req('/auth/login', { ip: mainIp, method: 'POST', body: { email: userEmail, password: 'wrong-password', ...s } })
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
