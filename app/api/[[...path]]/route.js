import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import QRCode from 'qrcode'
import dns from 'dns'

// Some networks only advertise an IPv6 link-local DNS server, which Node's resolver
// can't query (ECONNREFUSED on SRV lookups for the mongodb+srv:// connection string).
// Force known-good public resolvers so Mongo DNS lookups don't depend on the local network.
dns.setServers(['8.8.8.8', '1.1.1.1'])

// ---------------- MongoDB ----------------
// Raised when the database can't be reached, so the router can answer 503 ("try again")
// instead of a generic 500 that looks like an application bug.
class DbUnavailableError extends Error {
  constructor(cause) { super('Database unavailable'); this.name = 'DbUnavailableError'; this.cause = cause }
}
function isConnectivityError(err) {
  const n = err && err.name
  return n === 'MongoServerSelectionError' || n === 'MongoNetworkError' || n === 'MongoTopologyClosedError' || n === 'MongoNotConnectedError'
}

let clientPromise = null
async function connectToMongo() {
  if (!clientPromise) {
    // Fail fast. The driver defaults to a 30s server-selection timeout, which made every
    // request hang for ~30s and the whole site appear frozen whenever Atlas was unreachable.
    const attempt = new MongoClient(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 20000,
      maxPoolSize: 10,
    }).connect().then(async (c) => {
      const db = c.db(process.env.DB_NAME)
      // TTL indexes so rate-limit counters and CAPTCHA challenges clean themselves up —
      // created once per server process, not per request.
      await Promise.all([
        db.collection('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('captchaChallenges').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      ]).catch(() => {})
      return c
    })
    // A rejected promise left in the cache would be re-awaited by every future request,
    // so a single startup blip used to break the site permanently until a manual restart.
    // Clearing it means the next request transparently retries a fresh connection.
    clientPromise = attempt.catch((err) => { clientPromise = null; throw new DbUnavailableError(err) })
  }
  const c = await clientPromise
  return c.db(process.env.DB_NAME)
}
// Drop a live-but-broken client (network dropped after a successful connect) so the next
// request rebuilds it rather than reusing a dead topology forever.
function resetMongoOnConnectivityError(err) {
  if (err instanceof DbUnavailableError || isConnectivityError(err)) {
    const dying = clientPromise
    clientPromise = null
    if (dying) Promise.resolve(dying).then(c => c && c.close && c.close(true)).catch(() => {})
  }
}

// Seeding only needs to happen once per process, not on every single request (it was
// costing two extra round-trips per API call).
let seedPromise = null
function ensureSeeded(db) {
  if (!seedPromise) seedPromise = doSeed(db).catch((e) => { seedPromise = null; throw e })
  return seedPromise
}

// ---------------- Rate limiting & cost controls ----------------
// Best-effort client IP from standard proxy headers (works behind the cloudflared tunnel /
// any reverse proxy); falls back to 'unknown' so limits still apply per-process if absent.
// SECURITY: X-Forwarded-For is attacker-controlled. A client can prepend any value, so
// trusting the FIRST entry hands out a fresh rate-limit bucket per request and nullifies
// every quota below. Order of trust:
//   1. CF-Connecting-IP — Cloudflare (incl. the cloudflared tunnel) overwrites this on the
//      way in, so a client-supplied value never survives.
//   2. The LAST X-Forwarded-For entry — appended by the nearest proxy, so a spoofed value
//      the client prepended sits earlier in the list and is ignored.
//   3. x-real-ip, then 'unknown'.
// Set TRUST_PROXY=false when running with no proxy in front to ignore these headers.
function clientIp(request) {
  const trustProxy = String(process.env.TRUST_PROXY ?? 'true').toLowerCase() !== 'false'
  if (trustProxy) {
    const cf = request.headers.get('cf-connecting-ip')
    if (cf) return cf.trim()
    const xf = request.headers.get('x-forwarded-for')
    if (xf) {
      const hops = xf.split(',').map(s => s.trim()).filter(Boolean)
      if (hops.length) return hops[hops.length - 1]
    }
    const real = request.headers.get('x-real-ip')
    if (real) return real.trim()
  }
  return 'unknown'
}
// Fixed-window counter backed by Mongo (same pattern as the existing login lockout).
// `key` should already include the feature name, e.g. `signup:${ip}`.
async function rateLimit(db, key, { max, windowMs }) {
  const now = Date.now()
  const windowStart = Math.floor(now / windowMs) * windowMs
  const id = `${key}:${windowStart}`
  const expiresAt = new Date(windowStart + windowMs + 60_000) // small buffer past the window
  const r = await db.collection('rateLimits').findOneAndUpdate(
    { id },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, returnDocument: 'after' }
  )
  const doc = (r && r.value) ? r.value : r
  const count = (doc && doc.count) || 1
  return { allowed: count <= max, retryAfterSec: Math.max(1, Math.ceil(((windowStart + windowMs) - now) / 1000)) }
}
function tooMany(retryAfterSec) {
  return handleCORS(NextResponse.json({ error: 'Too many requests — please slow down and try again shortly.' }, { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }))
}

// Defense in depth for per-IP quotas. Client IP is only ever a best guess — behind no
// proxy at all it is fully attacker-controlled — so an abuser who rotates it gets a fresh
// bucket every time. These ceilings are keyed on the FEATURE rather than the caller, which
// caps total damage (and, for the paid/external calls, total cost) no matter how many
// identities one attacker invents. Sized well above honest aggregate traffic.
async function globalCeiling(db, feature, { max, windowMs }) {
  return rateLimit(db, `global:${feature}`, { max, windowMs })
}

// ---------------- CAPTCHA (self-hosted, zero external dependency) ----------------
// A small math challenge rendered as scrambled vector line-art. Each glyph is drawn as a
// handful of raw <line> strokes (a tiny 7-segment-style font) instead of an SVG <text>
// node — earlier this used <text>, which meant the literal question string sat right in
// the markup and could be regexed straight out of the JSON response with zero image
// analysis (verified: `curl` + a regex recovered the answer with no OCR at all). Line
// strokes carry no machine-readable character data, so reading it back requires actually
// analyzing the image — the bar the original design was going for.
const DIGIT_SEGMENTS = {
  0: ['a', 'b', 'c', 'd', 'e', 'f'], 1: ['b', 'c'], 2: ['a', 'b', 'g', 'e', 'd'],
  3: ['a', 'b', 'g', 'c', 'd'], 4: ['f', 'g', 'b', 'c'], 5: ['a', 'f', 'g', 'c', 'd'],
  6: ['a', 'f', 'g', 'e', 'c', 'd'], 7: ['a', 'b', 'c'], 8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  9: ['a', 'b', 'c', 'd', 'f', 'g'],
}
// Segment endpoints in a local 16x26 glyph box (classic 7-segment layout).
const SEGMENT_LINES = {
  a: [2, 2, 14, 2], b: [14, 2, 14, 13], c: [14, 13, 14, 24], d: [2, 24, 14, 24],
  e: [2, 13, 2, 24], f: [2, 2, 2, 13], g: [2, 13, 14, 13],
}
function glyphLines(ch) {
  if (ch === '+') return [[8, 4, 8, 22], [2, 13, 14, 13]]
  if (ch === '-') return [[2, 13, 14, 13]]
  return (DIGIT_SEGMENTS[ch] || []).map(seg => SEGMENT_LINES[seg])
}
function genCaptchaSvg(question) {
  const width = 140, height = 50
  const colors = ['#a855f7', '#f472b6', '#c084fc', '#f3e8ff', '#7c3aed']
  let glyphs = ''
  const chars = question.split('')
  const spacing = width / (chars.length + 1)
  chars.forEach((ch, i) => {
    const cx = spacing * (i + 1) + (Math.random() * 6 - 3)
    const cy = height / 2 + (Math.random() * 6 - 3)
    const rot = Math.floor(Math.random() * 34 - 17)
    const scale = 0.85 + Math.random() * 0.3
    const color = colors[Math.floor(Math.random() * colors.length)]
    const sw = (1.6 + Math.random() * 1.2).toFixed(1)
    const lines = glyphLines(ch).map(([x1, y1, x2, y2]) => {
      const jx = () => Math.random() * 1.4 - 0.7
      const jy = () => Math.random() * 1.4 - 0.7
      return `<line x1="${(x1 + jx()).toFixed(1)}" y1="${(y1 + jy()).toFixed(1)}" x2="${(x2 + jx()).toFixed(1)}" y2="${(y2 + jy()).toFixed(1)}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`
    }).join('')
    // Center the 16x26 glyph box on (cx, cy) before rotating/scaling around that same point.
    glyphs += `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${rot}) scale(${scale.toFixed(2)}) translate(-8 -13)">${lines}</g>`
  })
  let noise = ''
  for (let i = 0; i < 5; i++) {
    noise += `<line x1="${(Math.random() * width).toFixed(1)}" y1="${(Math.random() * height).toFixed(1)}" x2="${(Math.random() * width).toFixed(1)}" y2="${(Math.random() * height).toFixed(1)}" stroke="rgba(163,148,199,0.3)" stroke-width="1"/>`
  }
  for (let i = 0; i < 18; i++) {
    noise += `<circle cx="${(Math.random() * width).toFixed(1)}" cy="${(Math.random() * height).toFixed(1)}" r="0.8" fill="rgba(243,232,255,0.2)"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#140a24"/>${noise}${glyphs}</svg>`
}
async function createCaptchaChallenge(db) {
  const a = 1 + Math.floor(Math.random() * 9)
  const b = 1 + Math.floor(Math.random() * 9)
  let answer, question
  if (Math.random() < 0.5) { answer = a + b; question = `${a} + ${b}` }
  else { const hi = Math.max(a, b), lo = Math.min(a, b); answer = hi - lo; question = `${hi} - ${lo}` }
  const id = uuidv4()
  const now = new Date()
  await db.collection('captchaChallenges').insertOne({ id, answer, used: false, createdAt: now, expiresAt: new Date(now.getTime() + 5 * 60 * 1000) })
  return { captchaId: id, svg: genCaptchaSvg(question) }
}
// Single-use: correct or not, the challenge is consumed so it can't be replayed.
async function verifyCaptcha(db, captchaId, answer) {
  if (!captchaId || answer == null || answer === '') return false
  const c = await db.collection('captchaChallenges').findOne({ id: String(captchaId) })
  if (!c || c.used || c.expiresAt < new Date()) return false
  await db.collection('captchaChallenges').updateOne({ id: c.id }, { $set: { used: true } })
  return Number(answer) === c.answer
}

const ROBUX_RATE = 80 // R$ per USD (display only)

// Derives the origin the admin is actually browsing from (localhost, a tunnel, a real
// domain — whatever it is right now) instead of a fixed env var, so links generated for
// this request always land back on the same origin the admin is authenticated on.
function requestOrigin(request) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (!host) return process.env.NEXT_PUBLIC_BASE_URL || ''
  const proto = request.headers.get('x-forwarded-proto') || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https')
  return `${proto}://${host}`
}

function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}
export async function OPTIONS() { return handleCORS(new NextResponse(null, { status: 200 })) }
function json(data, status = 200) { return handleCORS(NextResponse.json(data, { status })) }
// Strips fields that must never reach a client: the password, and both TOTP secret fields
// (the enabled one and any in-progress pending one). `totpEnabled` — a plain boolean, not a
// secret — is kept since the UI needs it to decide what to show.
function clean(doc) { if (!doc) return doc; const { _id, password, totpSecret, totpPendingSecret, ...rest } = doc; return rest }
function publicUser(u) { if (!u) return null; const { _id, password, email, totpSecret, totpPendingSecret, ...rest } = u; return rest }

async function getUser(request, db) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.replace('Bearer ', '').trim()
  if (!token) return null
  return await db.collection('users').findOne({ id: token })
}
async function notify(db, userId, text, type = 'info') {
  await db.collection('notifications').insertOne({ id: uuidv4(), userId, text, type, read: false, createdAt: new Date() })
}
// ---------------- Analytics date helpers ----------------
// Returns the last N "YYYY-MM" month keys ending at the current month, oldest first.
function monthRangeKeys(range) {
  const n = { '3m': 3, '6m': 6, '9m': 9, '1y': 12 }[range] || 3
  const now = new Date()
  const months = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}
// { start, end } Date bounds (end exclusive) for a "YYYY-MM" month key.
function monthBounds(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) }
}
async function nextTxNumber(db) {
  const r = await db.collection('counters').findOneAndUpdate(
    { id: 'transactions' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  )
  const doc = (r && r.value) ? r.value : r
  return (doc && typeof doc.seq === 'number') ? doc.seq : 1
}
async function fulfillListing(db, listingId) {
  const l = await db.collection('listings').findOne({ id: listingId })
  if (!l) return
  if (typeof l.stock === 'number') {
    const newStock = Math.max(0, l.stock - 1)
    const upd = { stock: newStock, soldCount: (l.soldCount || 0) + 1 }
    if (newStock <= 0) { upd.status = 'sold'; upd.soldAt = new Date() }
    await db.collection('listings').updateOne({ id: listingId }, { $set: upd })
  } else {
    await db.collection('listings').updateOne({ id: listingId }, { $set: { status: 'sold', soldAt: new Date() } })
  }
}

// ---------------- BlockBee (crypto payments) ----------------
const BLOCKBEE_API = 'https://api.blockbee.io'
function blockbeeConfigured() { return !!(process.env.BLOCKBEE_API_KEY && process.env.BLOCKBEE_API_KEY.trim()) }

async function blockbeeGet(path, params = {}) {
  const url = new URL(`${BLOCKBEE_API}${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  }
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { apikey: process.env.BLOCKBEE_API_KEY, Accept: 'application/json' },
    cache: 'no-store'
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.status !== 'success') {
    throw new Error(data.message || data.error || `BlockBee HTTP ${res.status}`)
  }
  return data
}

// Hosted checkout: returns { payment_id, payment_url }
async function blockbeeCreateCheckout(order, listing) {
  const base = process.env.NEXT_PUBLIC_BASE_URL
  const notify = `${base}/api/payments/callback?order_id=${encodeURIComponent(order.orderId)}&nonce=${encodeURIComponent(order.nonce)}`
  const redirect = `${base}/?payment=success&orderId=${encodeURIComponent(order.orderId)}`
  return blockbeeGet('/checkout/request/', {
    value: Number(listing.price).toFixed(2),
    currency: 'usd',
    item_description: `Purchase of ${listing.item.name} on Robloot`,
    notify_url: notify,
    redirect_url: redirect,
    post: 1,
    json: 1
  })
}

// Authoritative status check (server-to-server): returns { is_paid, is_pending, is_expired, ... }
async function blockbeeGetLogs(paymentId) {
  return blockbeeGet('/checkout/logs/', { token: paymentId })
}

// Checks BlockBee for an order's real payment state and fulfills if paid. Returns updated status.
async function reconcileBlockbeeOrder(db, order) {
  if (!order || order.status === 'paid' || !order.blockbeePaymentId || !blockbeeConfigured()) return order?.status
  try {
    const logs = await blockbeeGetLogs(order.blockbeePaymentId)
    const paid = String(logs.is_paid) === '1' || logs.is_paid === 1 || logs.is_paid === true
    if (paid) {
      const r = await db.collection('orders').updateOne({ orderId: order.orderId, status: { $ne: 'paid' } }, { $set: { status: 'paid', paidAt: new Date() } })
      if (r.modifiedCount > 0) {
        if (order.type === 'toycode') await fulfillToycode(db, order.toycodeId, order.orderCode)
        else await fulfillListing(db, order.listingId)
        await notify(db, order.buyerId, `Payment confirmed! You now own ${order.item.name}.`, 'success')
      }
      return 'paid'
    }
    if (logs.is_expired) { await db.collection('orders').updateOne({ orderId: order.orderId, status: { $ne: 'paid' } }, { $set: { status: 'expired' } }); return 'expired' }
  } catch (e) { /* transient; keep current status */ }
  return order.status
}

// ---------------- Roblox lookup ----------------
function parseRobloxAssetId(value) {
  if (!value) return null
  const s = String(value).trim()
  if (/^\d+$/.test(s)) { const n = Number(s); return n > 0 ? n : null }
  try {
    const url = new URL(s.startsWith('http') ? s : ('https://' + s))
    const host = url.hostname.replace(/^www\./, '')
    if (!/roblox\.com$/.test(host)) { const m = s.match(/(\d{4,})/); return m ? Number(m[1]) : null }
    const pm = url.pathname.match(/\/(\d{2,})/)
    if (pm) return Number(pm[1])
    const id = url.searchParams.get('id') || url.searchParams.get('Id') || url.searchParams.get('ID') || url.searchParams.get('assetId') || url.searchParams.get('itemId')
    if (id && /^\d+$/.test(id)) return Number(id)
    return null
  } catch { const m = s.match(/(\d{4,})/); return m ? Number(m[1]) : null }
}
function robloxHeaders(json = false) {
  const h = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }
  if (json) h['Content-Type'] = 'application/json'
  if (process.env.ROBLOX_ACCESS_TOKEN) h.Authorization = `Bearer ${process.env.ROBLOX_ACCESS_TOKEN}`
  return h
}
async function robloxGetJson(url, options = {}, attempts = 2) {
  let lastErr
  let csrf = options._csrf
  for (let i = 0; i < attempts; i++) {
    try {
      const headers = { ...robloxHeaders(options.method === 'POST'), ...(options.headers || {}) }
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(url, { ...options, headers, cache: 'no-store' })
      if (res.ok) return await res.json()
      // Roblox CSRF handshake: 403 returns an x-csrf-token to retry with
      const token = res.headers.get('x-csrf-token')
      if (res.status === 403 && token && token !== csrf) { csrf = token; continue }
      if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 400 * (i + 1))); lastErr = new Error(`Roblox ${res.status}`); continue }
      throw new Error(`Roblox returned ${res.status}`)
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('Roblox request failed')
}
async function robloxLookup(input) {
  const assetId = parseRobloxAssetId(input)
  if (!assetId) throw new Error('Could not read an asset ID. Paste a link like https://www.roblox.com/catalog/1028606/Name')
  let name = null, description = '', lowestResalePrice = null, collectibleItemId = null
  try {
    const catalog = await robloxGetJson('https://catalog.roblox.com/v1/catalog/items/details', {
      method: 'POST', body: JSON.stringify({ items: [{ itemType: 'Asset', id: assetId }] })
    })
    const item = catalog && catalog.data && catalog.data[0]
    if (item) { name = item.name; description = item.description || ''; lowestResalePrice = item.lowestResalePrice ?? item.lowestPrice ?? item.price ?? null; collectibleItemId = item.collectibleItemId || null }
  } catch (e) {}
  if (!name) {
    // Fallback: legacy economy asset details
    try {
      const d = await robloxGetJson(`https://economy.roblox.com/v2/assets/${assetId}/details`)
      name = d.Name || d.name || null
      description = description || d.Description || ''
      if (lowestResalePrice == null) lowestResalePrice = d.PriceInRobux ?? null
      if (!collectibleItemId) collectibleItemId = d.CollectibleItemId || null
    } catch (e) {}
  }
  if (!name) throw new Error('Roblox did not return this item (it may be rate-limiting the server or the ID is not a catalog asset). Try again in a moment, or enter details manually.')
  let imageUrl = null
  for (let t = 0; t < 3 && !imageUrl; t++) {
    try {
      const thumb = await robloxGetJson(`https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=420x420&format=Png&isCircular=false`)
      const d = thumb && thumb.data && thumb.data[0]
      if (d && d.state === 'Completed' && d.imageUrl) { imageUrl = d.imageUrl; break }
      if (d && d.imageUrl) imageUrl = d.imageUrl
    } catch (e) {}
    if (!imageUrl) await new Promise(r => setTimeout(r, 500))
  }
  let rap = null
  if (collectibleItemId) {
    try { const m = await robloxGetJson(`https://apis.roblox.com/marketplace-sales/v1/item/${encodeURIComponent(collectibleItemId)}/resale-data`); rap = m.recentAveragePrice ?? null } catch (e) {}
  }
  if (rap == null) {
    try { const l = await robloxGetJson(`https://economy.roblox.com/v1/assets/${assetId}/resale-data`); rap = l.recentAveragePrice ?? null } catch (e) {}
  }
  return { assetId, name, description, imageUrl, lowestResalePrice, rap, collectibleItemId }
}

// ---------------- Roblox USER profiles ----------------
function parseRobloxUserRef(input) {
  const s = String(input || '').trim()
  const m = s.match(/users\/(\d+)/i)
  if (m) return { userId: Number(m[1]) }
  if (/^\d+$/.test(s)) return { userId: Number(s) }
  const uname = s.replace(/^@/, '').replace(/^https?:\/\/[^/]+\//, '').split(/[/?#]/)[0]
  return { username: uname || s }
}
async function robloxAssetThumbs(ids) {
  const map = {}
  const uniq = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100)
    try { const t = await robloxGetJson(`https://thumbnails.roblox.com/v1/assets?assetIds=${chunk.join(',')}&size=150x150&format=Png&isCircular=false`); (t.data || []).forEach(d => { map[d.targetId] = d.imageUrl }) } catch (e) {}
  }
  return map
}
async function robloxProfile(input) {
  const ref = parseRobloxUserRef(input)
  let userId = ref.userId
  if (!userId) {
    const r = await robloxGetJson('https://users.roblox.com/v1/usernames/users', { method: 'POST', body: JSON.stringify({ usernames: [ref.username], excludeBannedUsers: false }) })
    const u = r && r.data && r.data[0]
    if (!u) throw new Error('Roblox user not found')
    userId = u.id
  }
  const [info, avatar, head] = await Promise.all([
    robloxGetJson(`https://users.roblox.com/v1/users/${userId}`),
    robloxGetJson(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`).catch(() => null),
    robloxGetJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`).catch(() => null)
  ])
  return {
    id: userId, name: info.name, displayName: info.displayName, description: info.description || '',
    created: info.created, isBanned: !!info.isBanned, hasVerifiedBadge: !!info.hasVerifiedBadge,
    avatarUrl: (avatar && avatar.data && avatar.data[0] && avatar.data[0].imageUrl) || null,
    headshotUrl: (head && head.data && head.data[0] && head.data[0].imageUrl) || null
  }
}
async function robloxLimiteds(userId) {
  let data = []
  let cursor = ''
  // Paginate through ALL collectibles (Roblox caps at 100/page). Accounts can hold hundreds.
  for (let page = 0; page < 30; page++) {
    const url = `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const r = await robloxGetJson(url)
    data = data.concat(r.data || [])
    cursor = r.nextPageCursor
    if (!cursor) break
  }
  const thumbs = await robloxAssetThumbs(data.map(d => d.assetId))
  return data.map(d => ({ assetId: d.assetId, name: d.name, rap: d.recentAveragePrice, originalPrice: d.originalPrice, serialNumber: d.serialNumber, stock: d.assetStock, imageUrl: thumbs[d.assetId] || null }))
}

// ---------------- Roblox premium (Open Cloud API key) + checkout eligibility ----------------
// Premium is read via a Roblox Open Cloud API key (server-side only, never sent to the browser).
// Trades privacy is NOT exposed by Roblox to third parties at all, so the checkout always shows
// an "enable trades" guidance reminder instead of a verified result.
const RAP_LIMIT = 1500
function openCloudKey() { const k = process.env.ROBLOX_OPENCLOUD_KEY; return k && k.trim() ? k.trim() : null }
function robloxCookie() { const c = process.env.ROBLOX_COOKIE; return c && c.trim() ? c.trim() : null }
async function robloxCookieGetJson(url) {
  const ck = robloxCookie()
  if (!ck) throw new Error('no cookie')
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0', Cookie: `.ROBLOSECURITY=${ck}` }, cache: 'no-store' })
  if (!res.ok) throw new Error(`Roblox ${res.status}`)
  return await res.json()
}
async function robloxPremium(userId) {
  const key = openCloudKey()
  if (!key) return { premium: null, checked: false }
  try {
    const res = await fetch(`https://apis.roblox.com/cloud/v2/users/${userId}`, { headers: { 'x-api-key': key, Accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) return { premium: null, checked: false }
    const d = await res.json()
    return { premium: !!d.premium, checked: true }
  } catch (e) { return { premium: null, checked: false } }
}
// Trades: uses the server's trade-eligible bot cookie. can-trade-with reflects the TARGET's trade
// setting (CanTrade / ReceiverCannotTrade / privacy). If our bot itself can't trade -> unchecked (UI shows guidance).
async function robloxTrades(userId) {
  if (!robloxCookie()) return { enabled: null, checked: false, status: null }
  try {
    const t = await robloxCookieGetJson(`https://trades.roblox.com/v1/users/${userId}/can-trade-with`)
    const status = t.status || null
    if (status === 'SenderCannotTrade' || status === 'InsufficientPermissions' || status === 'Unknown') return { enabled: null, checked: false, status }
    if (t.canTrade === true || status === 'CanTrade') return { enabled: true, checked: true, status }
    return { enabled: false, checked: true, status } // ReceiverCannotTrade, privacy filters, etc.
  } catch (e) { return { enabled: null, checked: false, status: null } }
}
async function robloxCheckoutEligibility(userId) {
  const out = {
    userId: Number(userId),
    premium: null, premiumChecked: false,
    inventoryPublic: null, inventoryChecked: false,
    tradesEnabled: null, tradeStatus: null, tradesChecked: false,
    limiteds: [], rapLimit: RAP_LIMIT
  }
  // Inventory visibility (public endpoint, no auth needed)
  try { const iv = await robloxGetJson(`https://inventory.roblox.com/v1/users/${userId}/can-view-inventory`); out.inventoryPublic = !!iv.canView; out.inventoryChecked = true } catch (e) {}
  // Premium via Roblox Open Cloud
  const p = await robloxPremium(userId)
  out.premium = p.premium; out.premiumChecked = p.checked
  // Trades via bot cookie
  const t = await robloxTrades(userId)
  out.tradesEnabled = t.enabled; out.tradeStatus = t.status; out.tradesChecked = t.checked
  // Owned limiteds so the buyer can pick which item(s) to give (each flagged if RAP >= limit)
  try { out.limiteds = await robloxLimiteds(userId) } catch (e) { out.limiteds = [] }
  return out
}

// ---------------- Reviews / eBay feedback import ----------------
function decodeEntities(s) {
  if (!s) return s
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .trim()
}
async function fetchEbayFeedback(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', Accept: 'text/html' }, cache: 'no-store' })
  if (!res.ok) throw new Error(`eBay returned HTTP ${res.status}`)
  const html = await res.text()
  const handleM = url.match(/feedback_profile\/([^/?#]+)/)
  const handle = handleM ? decodeURIComponent(handleM[1]) : null
  const scoreM = html.match(/Feedback score is ([\d,]+)/i)
  const feedbackScore = scoreM ? Number(scoreM[1].replace(/,/g, '')) : null
  const blocks = html.split('data-feedback-id=').slice(1)
  const items = []
  for (const b of blocks) {
    const fid = (b.match(/^(\d+)/) || [])[1]
    const rating = (b.match(/data-test-type=(\w+)/) || [])[1] || 'positive'
    const comment = decodeEntities((b.match(/card__comment><span[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '')
    const author = decodeEntities((b.match(/card__from><span[^>]*>([^<]*)<\/span>/) || [])[1] || '')
    const item = decodeEntities((b.match(/card__item><span>([^<]*)<\/span>/) || [])[1] || '')
    const period = decodeEntities((b.match(/aria-label="(Past[^"]*|More than[^"]*|Longer[^"]*)"/) || [])[1] || '')
    if (fid && comment) items.push({ ebayFeedbackId: fid, rating, comment, author, item, period })
  }
  return { handle, feedbackScore, items }
}

// Eldorado exposes a genuine public JSON API behind its Angular app (confirmed by
// inspecting real network traffic — this isn't guessed). Two calls: resolve the
// username to its internal seller id, then page through that seller's reviews.
async function fetchEldoradoFeedback(url) {
  const m = String(url).match(/eldorado\.gg\/users\/([^/?#]+)/i)
  if (!m) throw new Error('Enter a valid Eldorado profile URL (eldorado.gg/users/USERNAME/reviews)')
  const username = decodeURIComponent(m[1])
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', Accept: 'application/json' }

  const profRes = await fetch(`https://www.eldorado.gg/api/users/${encodeURIComponent(username)}/publicByUsername`, { headers, cache: 'no-store' })
  if (!profRes.ok) throw new Error(`Eldorado returned HTTP ${profRes.status} looking up "${username}"`)
  const profile = await profRes.json().catch(() => null)
  const userId = profile?.id
  if (!userId) throw new Error(`Could not find an Eldorado seller named "${username}"`)

  const items = []
  // The site's own "give me everything" cursor — an all-9s max-date sentinel, taken
  // verbatim from the real request the page makes for the first page.
  let cursor = '9999-99-99 99:99:99.999999999999999-9999-9999-9999-999999999999'
  let ratingCount = null, positivePct = null
  const MAX_PAGES = 10 // ~500 reviews per import run — plenty for a seller profile
  for (let page = 0; page < MAX_PAGES; page++) {
    // 50 is the server's own max page size — confirmed against the live API (100 gets
    // rejected with a 400); the site's own UI requests 40.
    const qs = new URLSearchParams({ cursorValue: cursor, pageSize: '50', pageDirection: 'Next' })
    const res = await fetch(`https://www.eldorado.gg/api/orders/reviews/${userId}?${qs}`, { headers, cache: 'no-store' })
    if (!res.ok) throw new Error(`Eldorado returned HTTP ${res.status} fetching reviews`)
    const data = await res.json().catch(() => null)
    if (!data) throw new Error('Eldorado returned an unexpected response')
    if (ratingCount == null) {
      ratingCount = data.userOrderInfo?.ratingCount ?? null
      positivePct = data.userOrderInfo?.feedbackScore ?? null
    }
    const results = data.reviews?.results || []
    for (const r of results) {
      const rv = r.orderReview?.review
      const comment = decodeEntities(rv?.reviewMessage || '')
      if (!comment) continue // star-only reviews with no written text — nothing to show
      const rating = rv.feedbackRating === 'Negative' ? 'negative' : rv.feedbackRating === 'Positive' ? 'positive' : 'neutral'
      items.push({
        sourceId: r.orderReview.id,
        rating, comment,
        author: r.buyer?.maskedUsername || '',
        item: r.orderReview.gameCategoryTitle || '',
        period: r.orderReview.date ? new Date(r.orderReview.date).toLocaleDateString() : '',
      })
    }
    const next = data.reviews?.nextPageCursor
    if (!next || results.length === 0) break
    cursor = next
  }
  // ratingCount is a raw count (mirrors eBay's "feedback score" count) — positivePct is a
  // percentage and must never be written into a sales-count field.
  return { handle: username, ratingCount, positivePct, items }
}

// ---------------- Digital-goods claim + Discord webhook ----------------
// 6-char mixed-case+digit public order code, e.g. "23rW2s" — used in /order/<code> links.
function genOrderCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}
async function uniqueOrderCode(db) {
  for (let i = 0; i < 5; i++) {
    const code = genOrderCode()
    if (!(await db.collection('orders').findOne({ orderCode: code }))) return code
  }
  return genOrderCode() + Date.now().toString(36).slice(-2)
}
// Called once a website purchase of a toy code is confirmed paid: decrements stock and
// queues the order awaiting its code, without disturbing other stock units still awaiting
// their own buyer (supports concurrent multi-stock sales). The code itself is entered by
// an admin per-order afterward (see the toycodes/:id/fulfill route), not at listing time.
async function fulfillToycode(db, toycodeId, orderCode) {
  const tc = await db.collection('toycodes').findOne({ id: toycodeId })
  if (!tc) return
  const newStock = Math.max(0, (typeof tc.stock === 'number' ? tc.stock : 1) - 1)
  const upd = { stock: newStock }
  if (newStock <= 0) upd.status = 'sold'
  await db.collection('toycodes').updateOne({ id: toycodeId }, { $set: upd, $push: { pendingOrders: { orderCode, code: '', createdAt: new Date() } } })
}
// Normalizes a Discord username for comparison — strips a leading "@", an old-style
// "#1234" discriminator, surrounding whitespace, and case.
function normDiscordName(s) { return String(s || '').trim().toLowerCase().replace(/^@/, '').split('#')[0] }
// Confirms the Discord account running /claim is the same one that placed the order.
// Prefers the numeric Discord ID (unambiguous); falls back to username if no ID was given
// at checkout. Orders with no buyerInfo at all (nothing to check against) pass through.
async function verifyClaimOwner(db, orderCode, discordUserId, discordUsername) {
  const order = await db.collection('orders').findOne({ orderCode })
  const info = order?.buyerInfo
  if (!info || (!info.discordId && !info.discordName)) return true
  if (info.discordId) return !!discordUserId && String(discordUserId) === String(info.discordId)
  return !!discordUsername && normDiscordName(discordUsername) === normDiscordName(info.discordName)
}
async function claimDeliverable(db, orderNumber, discordUserId, discordUsername) {
  const on = String(orderNumber).trim()
  // 1) Website purchases queued via pendingOrders (supports multiple concurrent buyers of the same product)
  const tcPending = await db.collection('toycodes').findOne({ 'pendingOrders.orderCode': on })
  if (tcPending) {
    if (!(await verifyClaimOwner(db, on, discordUserId, discordUsername))) return { type: 'forbidden' }
    const entry = (tcPending.pendingOrders || []).find(p => p.orderCode === on)
    if (!entry?.code) return { type: 'pending' } // paid, but admin hasn't entered the code yet
    await db.collection('toycodes').updateOne({ id: tcPending.id }, { $pull: { pendingOrders: { orderCode: on } }, $push: { claimedOrders: { orderCode: on, discordUserId: discordUserId || null, claimedAt: new Date() } } })
    return { type: 'toycode', title: tcPending.title, code: entry.code }
  }
  const accPending = await db.collection('accounts').findOne({ 'pendingOrders.orderCode': on })
  if (accPending) {
    if (!(await verifyClaimOwner(db, on, discordUserId, discordUsername))) return { type: 'forbidden' }
    const entry = (accPending.pendingOrders || []).find(p => p.orderCode === on)
    if (!entry?.credentials?.username) return { type: 'pending' }
    await db.collection('accounts').updateOne({ id: accPending.id }, { $pull: { pendingOrders: { orderCode: on } }, $push: { claimedOrders: { orderCode: on, discordUserId: discordUserId || null, claimedAt: new Date() } } })
    return { type: 'account', title: accPending.title, credentials: entry.credentials }
  }
  // 2) Legacy path: admin manually assigned via the dashboard's "Assign to order" (single order per item)
  const tc = await db.collection('toycodes').findOne({ claimOrderNumber: on, status: { $ne: 'claimed' } })
  if (tc) {
    await db.collection('toycodes').updateOne({ id: tc.id }, { $set: { status: 'claimed', claimedBy: discordUserId || null, claimedAt: new Date() } })
    return { type: 'toycode', title: tc.title, code: tc.code }
  }
  const acc = await db.collection('accounts').findOne({ claimOrderNumber: on, status: { $ne: 'claimed' } })
  if (acc) {
    await db.collection('accounts').updateOne({ id: acc.id }, { $set: { status: 'claimed', claimedBy: discordUserId || null, claimedAt: new Date() } })
    return { type: 'account', title: acc.title, credentials: acc.credentials }
  }
  return null
}
// ---------------- TOTP (RFC 6238) — Google Authenticator / any standard authenticator app ----------------
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
// ---------------- Password hashing (scrypt, Node's built-in — no extra dependency) ----------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}
// Accepts both the new hashed format and legacy plaintext (from before this fix) so existing
// accounts keep working — the login route re-hashes automatically on next successful login.
function verifyPasswordFlexible(input, stored) {
  const s = String(stored || '')
  if (s.startsWith('scrypt:')) {
    const [, salt, hash] = s.split(':')
    if (!salt || !hash) return false
    try {
      const hashBuf = Buffer.from(hash, 'hex')
      const testHash = crypto.scryptSync(input, salt, 64)
      return hashBuf.length === testHash.length && crypto.timingSafeEqual(hashBuf, testHash)
    } catch { return false }
  }
  return input === s
}
// ---------------- Login rate limiting (covers both password and TOTP-code guessing) ----------------
const LOGIN_MAX_ATTEMPTS = 8
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000
async function checkLoginLockout(db, email) {
  const rec = await db.collection('loginAttempts').findOne({ email })
  if (rec?.lockedUntil && new Date(rec.lockedUntil) > new Date()) {
    return { locked: true, retryAfterSeconds: Math.ceil((new Date(rec.lockedUntil) - new Date()) / 1000) }
  }
  return { locked: false }
}
async function recordLoginFailure(db, email) {
  const now = new Date()
  const rec = await db.collection('loginAttempts').findOne({ email })
  if (!rec || new Date(rec.windowStart).getTime() < now.getTime() - LOGIN_WINDOW_MS) {
    await db.collection('loginAttempts').updateOne({ email }, { $set: { email, count: 1, windowStart: now }, $unset: { lockedUntil: '' } }, { upsert: true })
    return
  }
  const count = (rec.count || 0) + 1
  const upd = { count }
  if (count >= LOGIN_MAX_ATTEMPTS) upd.lockedUntil = new Date(now.getTime() + LOGIN_LOCKOUT_MS)
  await db.collection('loginAttempts').updateOne({ email }, { $set: upd })
}
async function clearLoginAttempts(db, email) { await db.collection('loginAttempts').deleteOne({ email }) }

function base32Encode(buf) {
  let bits = '', out = ''
  for (const b of buf) bits += b.toString(2).padStart(8, '0')
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)]
  return out
}
function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const c of clean) bits += B32_ALPHABET.indexOf(c).toString(2).padStart(5, '0')
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}
function genTotpSecret() { return base32Encode(crypto.randomBytes(20)) } // 160-bit, standard length

// Encrypts TOTP secrets at rest (AES-256-GCM) so a raw database dump alone isn't enough to
// clone someone's authenticator — the key only ever lives in this server's env, never in Mongo.
function totpKey() {
  const k = process.env.TOTP_ENCRYPTION_KEY
  if (!k) throw new Error('TOTP_ENCRYPTION_KEY is not set')
  return crypto.createHash('sha256').update(k).digest()
}
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', totpKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}
// Base32 secrets never contain ':', so anything without one is a pre-encryption legacy value —
// returned as-is rather than erroring, so an existing enrolled authenticator keeps working
// until it's naturally rewritten (next disable/re-setup re-saves it encrypted).
function decryptSecret(blob) {
  const s = String(blob || '')
  if (!s.includes(':')) return s
  try {
    const [ivB64, tagB64, dataB64] = s.split(':')
    const decipher = crypto.createDecipheriv('aes-256-gcm', totpKey(), Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
  } catch { return s }
}
function verifyTotpEncrypted(encSecret, code) { try { return verifyTotp(decryptSecret(encSecret), code) } catch { return false } }
function totpAt(secretB32, timeMs, step = 30, digits = 6) {
  const counter = Math.floor(timeMs / 1000 / step)
  const key = base32Decode(secretB32)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % (10 ** digits)
  return String(code).padStart(digits, '0')
}
// Accepts a ±1 step (±30s) window so minor clock drift between server and phone still works.
function verifyTotp(secretB32, code) {
  const c = String(code || '').trim()
  if (!/^\d{6}$/.test(c)) return false
  const now = Date.now()
  for (let i = -1; i <= 1; i++) { if (totpAt(secretB32, now + i * 30000) === c) return true }
  return false
}
function totpAuthUrl(secretB32, label, issuer) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}
function verifyDiscordSig(publicKeyHex, signatureHex, timestamp, body) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' })
    return crypto.verify(null, Buffer.from(timestamp + body), key, Buffer.from(signatureHex, 'hex'))
  } catch (e) { return false }
}
function claimMessage(d, orderNumber) {
  if (!d) return `\u274c No claimable delivery found for order #${orderNumber}. Make sure it's paid and the order number is correct.`
  if (d.type === 'pending') return `\u23f3 Your order has been received and payment confirmed. Codes are prepared individually for each order, so please allow up to one hour for yours to be ready. If you haven't received it after an hour, please contact support for assistance.`
  if (d.type === 'forbidden') return `\ud83d\udeab This order is registered to a different Discord account. Please run /claim from the same account you provided at checkout, or contact support if you believe this is an error.`
  if (d.type === 'toycode') return `\ud83c\udf9f\ufe0f **${d.title}**\nYour Roblox toy code: \`${d.code}\`\nRedeem it at https://www.roblox.com/redeem`
  const c = d.credentials || {}
  return `\ud83d\udc64 **${d.title}**\nUsername: \`${c.username}\`\nPassword: \`${c.password}\`${c.email ? `\nEmail: \`${c.email}\`` : ''}${c.notes ? `\nNotes: ${c.notes}` : ''}`
}
// ---------------- Discord REST helpers (bot token) ----------------
async function getBotCfg(db) { return (await db.collection('settings').findOne({ id: 'botConfig' })) || {} }
async function discordApi(botToken, method, apiPath, body) {
  try {
    const res = await fetch(`https://discord.com/api/v10${apiPath}`, {
      method,
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (https://robloot.com, 1.0)' },
      body: body != null ? JSON.stringify(body) : undefined
    })
    const text = await res.text()
    let data
    try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
    return { ok: res.ok, status: res.status, data }
  } catch (e) { return { ok: false, status: 0, data: { message: String(e) } } }
}
function buildDiscordEmbed(e) {
  const embed = {}
  if (e.title) embed.title = String(e.title).slice(0, 256)
  if (e.description) embed.description = String(e.description).slice(0, 4096)
  if (e.url) embed.url = String(e.url)
  if (e.color != null && e.color !== '') {
    let c = e.color
    if (typeof c === 'string') { c = parseInt(c.replace('#', ''), 16) }
    if (!isNaN(c)) embed.color = c
  }
  if (e.authorName) embed.author = { name: String(e.authorName).slice(0, 256) }
  if (e.thumbnailUrl) embed.thumbnail = { url: String(e.thumbnailUrl) }
  if (e.imageUrl) embed.image = { url: String(e.imageUrl) }
  if (e.footerText) embed.footer = { text: String(e.footerText).slice(0, 2048) }
  if (Array.isArray(e.fields) && e.fields.length) {
    embed.fields = e.fields.filter(f => f && (f.name || f.value)).slice(0, 25).map(f => ({
      name: String(f.name || '\u200b').slice(0, 256),
      value: String(f.value || '\u200b').slice(0, 1024),
      inline: !!f.inline
    }))
  }
  return embed
}

const REGULAR_TYPES = [[8, 'Hats'], [41, 'Hair'], [42, 'Face Accessories'], [43, 'Neck'], [44, 'Shoulder'], [45, 'Front'], [46, 'Back'], [47, 'Waist'], [18, 'Faces'], [19, 'Gear'], [11, 'Shirts'], [12, 'Pants'], [24, 'Animations']]
async function robloxRegularItems(userId) {
  const results = await Promise.allSettled(REGULAR_TYPES.map(([tid]) => robloxGetJson(`https://inventory.roblox.com/v2/users/${userId}/inventory/${tid}?limit=25&sortOrder=Desc`)))
  const items = []
  results.forEach((res, idx) => { if (res.status === 'fulfilled') { (res.value.data || []).forEach(d => items.push({ assetId: d.assetId, name: d.assetName, category: REGULAR_TYPES[idx][1] })) } })
  const thumbs = await robloxAssetThumbs(items.map(i => i.assetId))
  return items.map(i => ({ ...i, imageUrl: thumbs[i.assetId] || null }))
}
async function robloxGamePasses(userId) {
  let universes = []
  try { const g = await robloxGetJson(`https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=25&sortOrder=Asc`); universes = (g.data || []).map(x => ({ id: x.id, name: x.name })) } catch (e) {}
  const uni = universes.slice(0, 8)
  const passes = []
  const res = await Promise.allSettled(uni.map(u => robloxGetJson(`https://games.roblox.com/v1/games/${u.id}/game-passes?limit=100&sortOrder=Asc`)))
  res.forEach((r, idx) => { if (r.status === 'fulfilled') { (r.value.data || []).forEach(p => passes.push({ id: p.id, name: p.name, price: p.price ?? null, universe: uni[idx].name })) } })
  if (passes.length) {
    const map = {}
    for (let i = 0; i < passes.length; i += 100) {
      const chunk = passes.slice(i, i + 100)
      try { const t = await robloxGetJson(`https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${chunk.map(p => p.id).join(',')}&size=150x150&format=Png`); (t.data || []).forEach(d => { map[d.targetId] = d.imageUrl }) } catch (e) {}
    }
    passes.forEach(p => { p.imageUrl = map[p.id] || null })
  }
  return { games: universes, passes }
}
// Build TOTAL account RAP over time by summing per-item Roblox resale-data priceDataPoints.
// Roblox economy resale-data returns priceDataPoints:[{value,date}] (a real RAP time-series, no key needed).
async function robloxRapHistory(userId, limitedsIn) {
  const limiteds = limitedsIn || await robloxLimiteds(userId)
  const totalRap = limiteds.reduce((s, it) => s + (Number(it.rap) || 0), 0)
  // Track detailed history for the top holdings (by RAP) to keep request count bounded.
  const withRap = limiteds.filter(it => Number(it.rap) > 0)
  const top = [...withRap].sort((a, b) => b.rap - a.rap).slice(0, 30)
  const topIds = new Set(top.map(it => it.assetId))
  const restCurrent = withRap.filter(it => !topIds.has(it.assetId)).reduce((s, it) => s + (Number(it.rap) || 0), 0)

  const results = await Promise.allSettled(top.map(it =>
    robloxGetJson(`https://economy.roblox.com/v1/assets/${it.assetId}/resale-data`)))
  const perItem = results.map((r, i) => {
    const monthly = {}
    if (r.status === 'fulfilled') {
      (r.value.priceDataPoints || []).forEach(p => { if (p && p.date) monthly[String(p.date).slice(0, 7)] = Number(p.value) || 0 })
    }
    return { current: Number(top[i].rap) || 0, monthly }
  })

  // Last 12 month buckets (YYYY-MM)
  const months = []
  const now = new Date()
  for (let k = 11; k >= 0; k--) { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) }

  const history = months.map(mo => {
    let total = restCurrent // items without detailed history contribute their current RAP flat
    perItem.forEach(item => {
      const keys = Object.keys(item.monthly).filter(k => k <= mo).sort()
      if (keys.length) total += item.monthly[keys[keys.length - 1]]
      else {
        const all = Object.keys(item.monthly).sort()
        total += all.length ? item.monthly[all[0]] : item.current
      }
    })
    return { month: mo, rap: Math.round(total) }
  })
  return { totalRap: Math.round(totalRap), count: limiteds.length, tracked: top.length, history }
}

// ---------------- Seed ----------------
const ITEM_IMAGES = [
  'https://images.unsplash.com/photo-1665041982909-8a86864a1e49?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1Mjh8MHwxfHNlYXJjaHwxfHxnYW1pbmclMjBjb2xsZWN0aWJsZXxlbnwwfHx8fDE3ODc5MzAzNzJ8MA&ixlib=rb-4.1.0&q=85',
  'https://images.unsplash.com/photo-1774060526589-ef13301f6e17?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1Mjh8MHwxfHNlYXJjaHwzfHxnYW1pbmclMjBjb2xsZWN0aWJsZXxlbnwwfHx8fDE3ODc5MzAzNzJ8MA&ixlib=rb-4.1.0&q=85',
  'https://images.unsplash.com/photo-1649341566042-8b3f5103c3f3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1Mjh8MHwxfHNlYXJjaHwyfHxnYW1pbmclMjBjb2xsZWN0aWJsZXxlbnwwfHx8fDE3ODc5MzAzNzJ8MA&ixlib=rb-4.1.0&q=85',
  'https://images.unsplash.com/photo-1628126158163-35fd8ed7681a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MDV8MHwxfHNlYXJjaHwxfHxuZW9uJTIwdG95fGVufDB8fHx8MTc4NzkzMDM3Mnww&ixlib=rb-4.1.0&q=85',
  'https://images.unsplash.com/photo-1725575268896-fa1c209ded5c?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MDV8MHwxfHNlYXJjaHwyfHxuZW9uJTIwdG95fGVufDB8fHx8MTc4NzkzMDM3Mnww&ixlib=rb-4.1.0&q=85',
  'https://images.unsplash.com/photo-1767649195411-72e39fdd06dc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjV8MHwxfHNlYXJjaHwzfHx2aXJ0dWFsJTIwaXRlbXxlbnwwfHx8fDE3ODc5MzAzNzJ8MA&ixlib=rb-4.1.0&q=85',
  'https://images.unsplash.com/photo-1781409701110-18cad955a0a1?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjV8MHwxfHNlYXJjaHwxfHx2aXJ0dWFsJTIwaXRlbXxlbnwwfHx8fDE3ODc5MzAzNzJ8MA&ixlib=rb-4.1.0&q=85',
  'https://images.unsplash.com/photo-1772080506577-c0297928db01?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjV8MHwxfHNlYXJjaHwyfHx2aXJ0dWFsJTIwaXRlbXxlbnwwfHx8fDE3ODc5MzAzNzJ8MA&ixlib=rb-4.1.0&q=85',
  'https://images.unsplash.com/photo-1725297952113-36be1c7cefb4?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzN8MHwxfHNlYXJjaHwyfHx0b3klMjBjb2xsZWN0aWJsZXxlbnwwfHx8fDE3ODc5MzAzNzh8MA&ixlib=rb-4.1.0&q=85',
  'https://images.unsplash.com/photo-1558060370-d644479cb6f7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzN8MHwxfHNlYXJjaHwxfHx0b3klMjBjb2xsZWN0aWJsZXxlbnwwfHx8fDE3ODc5MzAzNzh8MA&ixlib=rb-4.1.0&q=85'
]
const SEED_ITEMS = [
  ['Shadow Dominex Crown', 'A legendary obsidian crown wreathed in shadow flames. Ultra-rare limited.', 'Limiteds'],
  ['Frostfire Valkyr Helm', 'Battle-worn helm with icy blue plumes. Coveted by collectors.', 'Limiteds'],
  ['Golden Sparkle Fedora', 'Glittering gold fedora that shimmers in any lighting.', 'Limiteds'],
  ['Prismatic Angel Wings', 'Rainbow-refracting wings with a soft glow trail.', 'Accessories'],
  ['Neon Cyber Visor', 'Futuristic visor with animated scanline HUD.', 'Accessories'],
  ['Galaxy Hoverboard', 'Anti-grav board leaving a starfield particle trail.', 'Gear'],
  ['Pixel Katana', 'Retro 8-bit blade that hums with pixel energy.', 'Gear'],
  ['Retro Arcade Headset', 'Chunky headset styled after classic arcade cabinets.', 'UGC'],
  ['Bubblegum Backpack', 'Squishy pink pack that bounces as you walk.', 'UGC'],
  ['Emerald Dragon Companion', 'A tiny loyal dragon that perches on your shoulder.', 'Collectibles'],
  ['Starlight Halo', 'A ring of drifting stars above your head. Limited run.', 'Limiteds'],
  ['Void Wanderer Cloak', 'Cloak woven from pure darkness, edges dissolve into mist.', 'Accessories'],
  ['Rainbow Trail Effect', 'Leaves a vivid rainbow streak wherever you go.', 'Gear'],
  ['Chibi Robot Buddy', 'Adorable clanking robot pet with blinking eyes.', 'Collectibles'],
  ['Molten Lava Wings', 'Wings of flowing magma that crackle with heat.', 'Accessories'],
  ['Crystal Skater Kicks', 'Translucent sneakers that glint like cut crystal.', 'UGC'],
  ['Phantom Mask', 'A haunting porcelain mask with a faint smile.', 'Faces'],
  ['Sunny Smile Face', 'The friendliest beaming face in the marketplace.', 'Faces'],
  ['Mecha Titan Bundle', 'Full mech armor set with animated thrusters.', 'Bundles'],
  ['Aqua Mermaid Tail', 'Iridescent tail that flows as if underwater.', 'UGC']
]
const SEED_VENDORS = [['PixelKing', 4.9, 1240], ['LootQueen', 4.8, 980], ['NeonTrader', 4.6, 540], ['VaultMaster', 4.7, 760], ['GlitchGoblin', 4.3, 210]]
const CONDITIONS = ['Mint', 'Rare', 'New', 'Used']
function pick(arr, i) { return arr[i % arr.length] }

async function ensureSoldSamples(db) {
  // No-op: marketplace uses only real imported items and real sold orders.
  return
}

async function doSeed(db, force = false) {
  // admin (always ensure exists)
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@robloot.com'
  const existingAdmin = await db.collection('users').findOne({ email: adminEmail })
  if (!existingAdmin) {
    await db.collection('users').insertOne({
      id: uuidv4(), username: 'Admin', email: adminEmail, password: hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
      avatarUrl: 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=Admin', reputation: 5,
      isAdmin: true, demo: true, createdAt: new Date()
    })
  }
  // ensure at least one house store exists (needed to attribute listings)
  const vendorCount = await db.collection('vendors').countDocuments()
  if (vendorCount === 0) {
    const vendors = [['Robloot Market', 5, 0], ...SEED_VENDORS].map(([name, reputation, sales]) => ({
      id: uuidv4(), name, avatarUrl: `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(name)}`,
      reputation, salesCount: sales, createdAt: new Date()
    }))
    await db.collection('vendors').insertMany(vendors)
  }
  // NOTE: marketplace starts EMPTY. Admin imports real items from Roblox catalog URLs.
  if (force) {
    await db.collection('items').deleteMany({})
    await db.collection('listings').deleteMany({})
    return { seeded: true, cleared: true }
  }
  return { seeded: false }
}

// ---------------- Router ----------------
async function handleRoute(request, { params }) {
  const { path = [] } = await params
  const route = `/${path.join('/')}`
  const method = request.method
  const url = new URL(request.url)
  const q = url.searchParams

  try {
    const db = await connectToMongo()
    await ensureSeeded(db)

    // ---------- Global request throttle (every route, every feature) ----------
    // A generous per-IP ceiling across the whole API as a baseline backstop; the
    // abuse-prone or costly endpoints below layer tighter, feature-specific quotas on top.
    const ip = clientIp(request)
    const globalThrottle = await rateLimit(db, `ip:${ip}`, { max: 180, windowMs: 60_000 })
    if (!globalThrottle.allowed) return tooMany(globalThrottle.retryAfterSec)

    if (route === '/' || route === '/root') return json({ message: 'Robloot Marketplace API' })
    if (route === '/seed' && method === 'POST') return json(await doSeed(db, true))
    if (route === '/config' && method === 'GET') return json({ cryptoConfigured: blockbeeConfigured(), provider: 'blockbee', receiveCurrency: process.env.BLOCKBEE_RECEIVE_CURRENCY || 'USDT' })
    if (route === '/captcha/new' && method === 'GET') return json(await createCaptchaChallenge(db))

    // ---------- DIGITAL GOODS STOREFRONT (public) ----------
    // Public, read-only listings of available toy codes / accounts. Never expose the
    // secret `code` or `credentials` fields here — those are only delivered post-purchase
    // via the Discord bot's /claim flow.
    if (route === '/toycodes' && method === 'GET') {
      const items = await db.collection('toycodes').find({ status: 'available' }).sort({ createdAt: -1 }).toArray()
      return json({ toycodes: items.map(t => ({ id: t.id, title: t.title, description: t.description, price: t.price, imageUrl: t.imageUrl, stock: t.stock ?? 1 })) })
    }
    if (route.startsWith('/toycodes/') && method === 'GET') {
      const t = await db.collection('toycodes').findOne({ id: path[1], status: 'available' })
      if (!t) return json({ error: 'Not found' }, 404)
      return json({ toycode: { id: t.id, title: t.title, description: t.description, price: t.price, imageUrl: t.imageUrl, stock: t.stock ?? 1 } })
    }
    if (route === '/accounts' && method === 'GET') {
      const items = await db.collection('accounts').find({ status: 'available' }).sort({ createdAt: -1 }).toArray()
      return json({ accounts: items.map(a => ({ id: a.id, title: a.title, description: a.description, price: a.price, imageUrl: a.imageUrl || a.snapshot?.profile?.headshotUrl || a.snapshot?.profile?.avatarUrl || '' })) })
    }
    // Public listing page for one imported account — the Roblox profile + inventory
    // snapshot taken at import time, minus `credentials` (that only ever appears in
    // admin-authenticated responses, delivered for real post-purchase via /claim).
    if (route.startsWith('/accounts/') && method === 'GET') {
      const a = await db.collection('accounts').findOne({ id: path[1], status: 'available' })
      if (!a) return json({ error: 'Not found' }, 404)
      return json({ account: {
        id: a.id, title: a.title, description: a.description, price: a.price,
        imageUrl: a.imageUrl || a.snapshot?.profile?.headshotUrl || a.snapshot?.profile?.avatarUrl || '',
        profile: a.snapshot?.profile || null,
        limiteds: a.snapshot?.limiteds || [], items: a.snapshot?.items || [], gamepasses: a.snapshot?.gamepasses?.passes || [],
      } })
    }

    // Buy a toy code: pay with crypto (BlockBee) or, for testing, a demo purchase that
    // skips payment entirely. Either way, delivery still happens in Discord via /claim.
    if (route.startsWith('/toycodes/') && route.endsWith('/order') && method === 'POST') {
      const user = await getUser(request, db)
      if (!user) return json({ error: 'Unauthorized' }, 401)
      const orderRl = await rateLimit(db, `order:${user.id}`, { max: 10, windowMs: 60 * 60 * 1000 })
      if (!orderRl.allowed) return tooMany(orderRl.retryAfterSec)
      const tc = await db.collection('toycodes').findOne({ id: path[1] })
      if (!tc || tc.status !== 'available') return json({ error: 'This item is no longer available' }, 400)
      if (typeof tc.stock === 'number' && tc.stock <= 0) return json({ error: 'Out of stock' }, 400)

      const b = await request.json().catch(() => ({}))
      const discordName = (b.discordName || '').toString().trim()
      const discordId = (b.discordId || '').toString().trim()
      if (!discordName) return json({ error: 'Please provide your Discord username before paying.' }, 400)
      // Required (not just username) so /claim can verify identity by ID — the one thing
      // that can't be mistyped, renamed, or confused with a display name.
      if (!/^\d{15,25}$/.test(discordId)) return json({ error: 'Please provide a valid Discord ID before paying (enable Developer Mode in Discord, then right-click your profile → Copy User ID).' }, 400)
      // Demo purchases skip real payment entirely — restricted to admins so a regular
      // buyer can never mint themselves a free paid order.
      const demo = !!b.demo && user.isAdmin

      const orderCode = await uniqueOrderCode(db)
      const order = {
        id: uuidv4(), orderId: `ord_${uuidv4()}`, orderCode, txNumber: await nextTxNumber(db),
        type: 'toycode', toycodeId: tc.id, item: { name: tc.title, imageUrl: tc.imageUrl },
        buyerId: user.id, buyerName: user.username, buyerInfo: { discordName, discordId },
        amountUsd: tc.price, currency: 'USD',
        provider: demo ? 'demo' : 'blockbee', status: 'pending_payment', checkoutUrl: null,
        nonce: uuidv4(), blockbeePaymentId: null, createdAt: new Date(), paidAt: null
      }
      await db.collection('orders').insertOne(order)

      if (demo) {
        await db.collection('orders').updateOne({ orderId: order.orderId }, { $set: { status: 'paid', paidAt: new Date() } })
        await fulfillToycode(db, tc.id, orderCode)
        await notify(db, user.id, `Payment confirmed! You now own ${tc.title}.`, 'success')
        return json({ orderCode, checkoutUrl: null, simulated: true })
      }
      if (!blockbeeConfigured()) {
        return json({ orderCode, checkoutUrl: null, simulated: true })
      }
      try {
        const base = requestOrigin(request)
        const notifyUrl = `${base}/api/payments/callback?order_id=${encodeURIComponent(order.orderId)}&nonce=${encodeURIComponent(order.nonce)}`
        const redirectUrl = `${base}/order/${orderCode}`
        const bb = await blockbeeGet('/checkout/request/', {
          value: Number(tc.price).toFixed(2), currency: 'usd', item_description: `Purchase of ${tc.title} on Robloot`,
          notify_url: notifyUrl, redirect_url: redirectUrl, post: 1, json: 1
        })
        await db.collection('orders').updateOne({ orderId: order.orderId }, { $set: { blockbeePaymentId: String(bb.payment_id), checkoutUrl: bb.payment_url } })
        return json({ orderCode, checkoutUrl: bb.payment_url })
      } catch (e) {
        await db.collection('orders').updateOne({ orderId: order.orderId }, { $set: { status: 'failed', error: e.message } })
        return json({ error: `Could not create crypto checkout: ${e.message}` }, 502)
      }
    }

    // Public: look up an order by its short public code (used by /order/<code>)
    if (route.startsWith('/orders/by-code/') && method === 'GET') {
      let order = await db.collection('orders').findOne({ orderCode: path[2] })
      if (!order) return json({ error: 'Not found' }, 404)
      if (order.status === 'pending_payment') {
        const s = await reconcileBlockbeeOrder(db, order)
        if (s && s !== order.status) order = await db.collection('orders').findOne({ orderCode: path[2] })
      }
      return json({ orderCode: order.orderCode, status: order.status, item: order.item, amountUsd: order.amountUsd, checkoutUrl: order.checkoutUrl, provider: order.provider })
    }

    // ---------- REVIEWS (public) ----------
    if (route === '/reviews' && method === 'GET') {
      const settings = await db.collection('settings').findOne({ id: 'reviews' })
      const sbs = { ebay: 0, eldorado: 0, sellauth: 0, g2g: 0, playerauctions: 0, other: 0, ...(settings?.salesBySource || {}) }
      if (!settings?.salesBySource && settings?.totalSales) sbs.other = settings.totalSales // legacy migrate for display
      const totalSales = ['ebay', 'eldorado', 'sellauth', 'g2g', 'playerauctions', 'other'].reduce((a, k) => a + (Number(sbs[k]) || 0), 0)
      const reviews = await db.collection('reviews').find({}).sort({ pinned: -1, createdAt: -1 }).toArray()
      return json({ totalSales, salesBySource: sbs, reviews: reviews.map(clean) })
    }

    // ---------- DISCORD BOT: claim delivery (toy code / account) ----------
    // Called by the Discord bot with a shared secret; delivers the assigned toy code or account login.
    if (route === '/discord/claim' && method === 'POST') {
      const secret = request.headers.get('x-bot-secret')
      if (!process.env.BOT_SHARED_SECRET || secret !== process.env.BOT_SHARED_SECRET) return json({ error: 'Unauthorized' }, 401)
      const b = await request.json().catch(() => ({}))
      if (!b.orderNumber) return json({ error: 'orderNumber required' }, 400)
      const d = await claimDeliverable(db, b.orderNumber, b.discordUserId, b.discordUsername)
      if (!d) return json({ error: 'No claimable delivery found for that order number.' }, 404)
      return json({ success: true, delivery: d, message: claimMessage(d, b.orderNumber) })
    }
    // Discord Interactions webhook (slash command /claim). Verifies Ed25519 signature once keys are set.
    if (route === '/discord/interactions' && method === 'POST') {
      const pub = process.env.DISCORD_PUBLIC_KEY
      const sig = request.headers.get('x-signature-ed25519')
      const ts = request.headers.get('x-signature-timestamp')
      const raw = await request.text()
      if (!pub) return json({ error: 'Discord interactions not configured yet' }, 503)
      if (!sig || !ts || !verifyDiscordSig(pub, sig, ts, raw)) return new NextResponse('invalid request signature', { status: 401 })
      let body = {}
      try { body = JSON.parse(raw) } catch (e) {}
      if (body.type === 1) return json({ type: 1 }) // PING
      // Autocomplete (type 4): suggest saved embed names for /embed
      if (body.type === 4) {
        if (body.data?.name === 'embed') {
          const foc = (body.data.options || []).find(o => o.focused)
          const q = (foc?.value || '').toString().toLowerCase()
          const all = await db.collection('embeds').find({}).sort({ createdAt: -1 }).toArray()
          const choices = all.filter(e => !q || e.name.toLowerCase().includes(q)).slice(0, 25).map(e => ({ name: e.name.slice(0, 100), value: e.name.slice(0, 100) }))
          return json({ type: 8, data: { choices } })
        }
        return json({ type: 8, data: { choices: [] } })
      }
      if (body.type === 2 && body.data?.name === 'claim') {
        const opt = (body.data.options || []).find(o => o.name === 'order')
        const orderNumber = opt?.value
        const discordUserId = body.member?.user?.id || body.user?.id
        const discordUsername = body.member?.user?.username || body.user?.username
        const d = await claimDeliverable(db, orderNumber, discordUserId, discordUsername)
        return json({ type: 4, data: { content: claimMessage(d, orderNumber), flags: 64 } })
      }
      if (body.type === 2 && body.data?.name === 'embed') {
        const opt = (body.data.options || []).find(o => o.name === 'name')
        const nm = (opt?.value || '').toString()
        const e = await db.collection('embeds').findOne({ name_lc: nm.toLowerCase() })
        if (!e) return json({ type: 4, data: { content: `\u274c No embed named "${nm}" was found.`, flags: 64 } })
        return json({ type: 4, data: { embeds: [buildDiscordEmbed(e)] } }) // public post
      }
      return json({ type: 4, data: { content: 'Unknown command', flags: 64 } })
    }

    // ---------- ROBLOX PROFILES (public) ----------
    // Cost control: every one of these hits Roblox's own API on our behalf — share one
    // per-IP quota across the whole group rather than limiting each sub-route separately.
    if ((route === '/profile/lookup' || route.startsWith('/profile/') || route === '/checkout/eligibility') && method === 'GET') {
      const rbxRl = await rateLimit(db, `robloxapi:${ip}`, { max: 40, windowMs: 60 * 60 * 1000 })
      if (!rbxRl.allowed) return tooMany(rbxRl.retryAfterSec)
    }
    if (route === '/profile/lookup' && method === 'GET') {
      const input = q.get('input')
      if (!input) return json({ error: 'Enter a Roblox username, ID, or profile link' }, 400)
      try { return json({ profile: await robloxProfile(input) }) }
      catch (e) { return json({ error: e.message || 'Lookup failed' }, 502) }
    }
    if (route.startsWith('/profile/') && path[2] === 'limiteds' && method === 'GET') {
      try { return json({ limiteds: await robloxLimiteds(path[1]) }) }
      catch (e) { return json({ limiteds: [], private: true, error: 'Inventory is private or unavailable' }) }
    }
    if (route.startsWith('/profile/') && path[2] === 'items' && method === 'GET') {
      try { const items = await robloxRegularItems(path[1]); return json({ items, private: items.length === 0 }) }
      catch (e) { return json({ items: [], private: true }) }
    }
    if (route.startsWith('/profile/') && path[2] === 'gamepasses' && method === 'GET') {
      try { return json(await robloxGamePasses(path[1])) }
      catch (e) { return json({ games: [], passes: [] }) }
    }
    if (route.startsWith('/profile/') && path[2] === 'rap-history' && method === 'GET') {
      try { return json(await robloxRapHistory(path[1])) }
      catch (e) { return json({ totalRap: 0, count: 0, tracked: 0, history: [], private: true }) }
    }
    // Checkout: verify buyer's Roblox account eligibility (premium / trades / inventory / owned limiteds)
    if (route === '/checkout/eligibility' && method === 'GET') {
      const userId = q.get('userId')
      if (!userId || !/^\d+$/.test(String(userId))) return json({ error: 'Valid Roblox userId required' }, 400)
      try { return json({ eligibility: await robloxCheckoutEligibility(userId) }) }
      catch (e) { return json({ error: e.message || 'Eligibility check failed' }, 502) }
    }

    // ---------- AUTH ----------
    // Every field below is coerced to a string (or rejected) before it ever reaches a Mongo
    // query — passing an object like {"$ne": null} as JSON must never be interpretable as a
    // query operator, or it becomes a full authentication-bypass NoSQL injection.
    if (route === '/auth/signup' && method === 'POST') {
      const signupRl = await rateLimit(db, `signup:${ip}`, { max: 5, windowMs: 60 * 60 * 1000 })
      if (!signupRl.allowed) return tooMany(signupRl.retryAfterSec)
      const b = await request.json()
      if (!(await verifyCaptcha(db, b.captchaId, b.captchaAnswer))) return json({ error: 'Incorrect CAPTCHA — please try again.', captchaRequired: true }, 400)
      const username = typeof b.username === 'string' ? b.username.trim() : ''
      const email = typeof b.email === 'string' ? b.email.trim() : ''
      const password = typeof b.password === 'string' ? b.password : ''
      if (!username || !email || !password) return json({ error: 'Missing fields' }, 400)
      const exists = await db.collection('users').findOne({ $or: [{ email }, { username }] })
      if (exists) return json({ error: 'Username or email already taken' }, 400)
      const user = {
        id: uuidv4(), username, email, password: hashPassword(password),
        avatarUrl: `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(username)}`,
        reputation: 5, isAdmin: false, demo: false, createdAt: new Date()
      }
      await db.collection('users').insertOne(user)
      await notify(db, user.id, 'Welcome to Robloot! Browse the marketplace and pay securely with crypto.', 'success')
      return json({ token: user.id, user: clean(user) })
    }
    if (route === '/auth/login' && method === 'POST') {
      const loginRl = await rateLimit(db, `login:${ip}`, { max: 30, windowMs: 15 * 60 * 1000 })
      if (!loginRl.allowed) return tooMany(loginRl.retryAfterSec)
      const b = await request.json()
      const email = typeof b.email === 'string' ? b.email.trim() : ''
      const password = typeof b.password === 'string' ? b.password : ''
      const totpCode = typeof b.totpCode === 'string' ? b.totpCode.trim() : ''
      if (!email || !password) return json({ error: 'Invalid credentials' }, 401)
      // CAPTCHA gates the password step (the actual brute-force target), not the follow-up
      // TOTP submit — that step is already behind a real second factor and the same lockout.
      if (!totpCode && !(await verifyCaptcha(db, b.captchaId, b.captchaAnswer))) {
        return json({ error: 'Incorrect CAPTCHA — please try again.', captchaRequired: true }, 400)
      }

      const lock = await checkLoginLockout(db, email)
      if (lock.locked) return json({ error: `Too many failed attempts. Try again in ${Math.ceil(lock.retryAfterSeconds / 60)} minute(s).` }, 429)

      // Fetched by email alone and verified in application code — a hashed password can't be
      // matched inside the query itself, which also fully removes that field as an injection target.
      const user = await db.collection('users').findOne({ email })
      if (!user || !verifyPasswordFlexible(password, user.password)) {
        await recordLoginFailure(db, email)
        return json({ error: 'Invalid credentials' }, 401)
      }
      // Opportunistically upgrade a legacy plaintext password to a proper hash now that we
      // have it in hand — no forced reset, no disruption, just a one-time silent upgrade.
      if (!String(user.password).startsWith('scrypt:')) {
        await db.collection('users').updateOne({ id: user.id }, { $set: { password: hashPassword(password) } })
      }
      // Second factor on the login itself (same authenticator secret used for the Discord
      // Dashboard) — a correct password alone is no longer enough to get a session.
      if (user.totpEnabled) {
        if (!totpCode) return json({ requiresTotp: true })
        if (!verifyTotpEncrypted(user.totpSecret, totpCode)) {
          await recordLoginFailure(db, email)
          return json({ error: 'Invalid authenticator code' }, 401)
        }
      }
      await clearLoginAttempts(db, email)
      return json({ token: user.id, user: clean(user) })
    }
    if (route === '/me' && method === 'GET') {
      const user = await getUser(request, db)
      if (!user) return json({ error: 'Unauthorized' }, 401)
      return json({ user: clean(user) })
    }

    // ---------- ITEMS ----------
    if (route === '/items' && method === 'GET') {
      const items = await db.collection('items').find({}).sort({ createdAt: -1 }).toArray()
      return json({ items: items.map(clean) })
    }
    if (route.startsWith('/items/') && method === 'GET') {
      const item = await db.collection('items').findOne({ id: path[1] })
      if (!item) return json({ error: 'Item not found' }, 404)
      const listings = await db.collection('listings').find({ itemId: path[1], status: 'active' }).sort({ price: 1 }).toArray()
      return json({ item: clean(item), listings: listings.map(clean) })
    }

    // ---------- LISTINGS (read only for public) ----------
    if (route === '/listings' && method === 'GET') {
      const filter = { status: 'active' }
      const search = q.get('search'), category = q.get('category'), condition = q.get('condition'), vendorId = q.get('vendorId')
      const minPrice = parseFloat(q.get('minPrice')), maxPrice = parseFloat(q.get('maxPrice'))
      if (category && category !== 'All') filter['item.category'] = category
      if (condition && condition !== 'All') filter.condition = condition
      if (vendorId) filter.vendorId = vendorId
      if (search) filter['item.name'] = { $regex: search, $options: 'i' }
      if (!isNaN(minPrice) || !isNaN(maxPrice)) { filter.price = {}; if (!isNaN(minPrice)) filter.price.$gte = minPrice; if (!isNaN(maxPrice)) filter.price.$lte = maxPrice }
      const sortMap = { price_asc: { price: 1 }, price_desc: { price: -1 }, newest: { createdAt: -1 }, popular: { popularity: -1 } }
      const listings = await db.collection('listings').find(filter).sort(sortMap[q.get('sort')] || { createdAt: -1 }).limit(200).toArray()
      return json({ listings: listings.map(clean) })
    }
    if (route.startsWith('/listings/') && method === 'GET') {
      const listing = await db.collection('listings').findOne({ id: path[1] })
      if (!listing) return json({ error: 'Listing not found' }, 404)
      const vendor = await db.collection('vendors').findOne({ id: listing.vendorId })
      return json({ listing: clean(listing), seller: vendor ? clean(vendor) : null })
    }

    // ---------- VENDORS ----------
    if (route === '/sold' && method === 'GET') {
      await ensureSoldSamples(db)
      const sold = await db.collection('listings').find({ status: 'sold' }).sort({ soldAt: -1, createdAt: -1 }).limit(12).toArray()
      return json({ listings: sold.map(clean) })
    }
    if (route === '/vendors' && method === 'GET') {
      const vendors = await db.collection('vendors').find({}).sort({ reputation: -1 }).toArray()
      return json({ vendors: vendors.map(clean) })
    }
    if (route.startsWith('/users/') && method === 'GET') {
      // seller/vendor profile by name
      const name = decodeURIComponent(path[1])
      const vendor = await db.collection('vendors').findOne({ name })
      if (!vendor) return json({ error: 'Vendor not found' }, 404)
      const listings = await db.collection('listings').find({ vendorId: vendor.id, status: 'active' }).sort({ createdAt: -1 }).toArray()
      return json({ user: clean(vendor), listings: listings.map(clean) })
    }

    // ---------- ORDERS (BUY via crypto) ----------
    if (route === '/orders' && method === 'POST') {
      const user = await getUser(request, db)
      if (!user) return json({ error: 'Unauthorized' }, 401)
      const orderRl = await rateLimit(db, `order:${user.id}`, { max: 10, windowMs: 60 * 60 * 1000 })
      if (!orderRl.allowed) return tooMany(orderRl.retryAfterSec)
      const b = await request.json()
      const listing = await db.collection('listings').findOne({ id: b.listingId })
      if (!listing) return json({ error: 'Listing not found' }, 404)
      if (listing.status !== 'active') return json({ error: 'This listing is no longer available' }, 400)

      const discordName = (b.discordName || '').toString().trim()
      const discordTag = (b.discordTag || '').toString().trim()
      const robloxUsername = (b.robloxUsername || '').toString().trim()
      if (!discordName || !robloxUsername) return json({ error: 'Please provide your Discord username and Roblox username before paying.' }, 400)
      const robloxUserId = b.robloxUserId ? Number(b.robloxUserId) : null
      const giveItems = Array.isArray(b.giveItems) ? b.giveItems.slice(0, 20).map(it => ({ assetId: it.assetId, name: it.name, rap: it.rap })) : []

      const order = {
        id: uuidv4(), orderId: `ord_${uuidv4()}`, txNumber: await nextTxNumber(db), listingId: listing.id, item: listing.item,
        buyerId: user.id, buyerName: user.username, sellerName: listing.sellerName,
        buyerInfo: { discordName, discordTag, robloxUsername, robloxUserId, giveItems },
        amountUsd: listing.price, currency: 'USD',
        provider: 'blockbee', status: 'pending_payment', checkoutUrl: null,
        nonce: uuidv4(), blockbeePaymentId: null, createdAt: new Date(), paidAt: null
      }
      await db.collection('orders').insertOne(order)
      if (!blockbeeConfigured()) {
        // Demo mode: no API key. Return order so client can complete a simulated payment.
        return json({ orderId: order.orderId, checkoutUrl: null, simulated: true })
      }
      try {
        const bb = await blockbeeCreateCheckout(order, listing)
        await db.collection('orders').updateOne({ orderId: order.orderId }, { $set: { blockbeePaymentId: String(bb.payment_id), checkoutUrl: bb.payment_url } })
        return json({ orderId: order.orderId, checkoutUrl: bb.payment_url })
      } catch (e) {
        await db.collection('orders').updateOne({ orderId: order.orderId }, { $set: { status: 'failed', error: e.message } })
        return json({ error: `Could not create crypto checkout: ${e.message}` }, 502)
      }
    }

    if (route === '/orders' && method === 'GET') {
      const user = await getUser(request, db)
      if (!user) return json({ error: 'Unauthorized' }, 401)
      const purchases = await db.collection('orders').find({ buyerId: user.id }).sort({ createdAt: -1 }).toArray()
      return json({ purchases: purchases.map(clean) })
    }

    // Admin-only transaction detail by sequential number (e.g. /transaction/1)
    if (route.startsWith('/transaction/') && method === 'GET') {
      const user = await getUser(request, db)
      if (!user || !user.isAdmin) return json({ error: 'Forbidden' }, 403)
      const num = parseInt(path[1], 10)
      if (!num) return json({ error: 'Not found' }, 404)
      const order = await db.collection('orders').findOne({ txNumber: num })
      if (!order) return json({ error: 'Not found' }, 404)
      return json({ transaction: clean(order) })
    }

    // ---------- PAYMENTS ----------
    if (route === '/payments/status' && method === 'GET') {
      const orderId = q.get('orderId')
      if (!orderId) return json({ error: 'orderId required' }, 400)
      let order = await db.collection('orders').findOne({ orderId })
      if (!order) return json({ error: 'Not found' }, 404)
      // Reconcile with BlockBee in case the webhook hasn't arrived yet
      if (order.status === 'pending_payment') {
        const s = await reconcileBlockbeeOrder(db, order)
        if (s && s !== order.status) order = await db.collection('orders').findOne({ orderId })
      }
      return json({ orderId, status: order.status, item: order.item, amountUsd: order.amountUsd, checkoutUrl: order.checkoutUrl })
    }

    if (route === '/payments/callback' && method === 'POST') {
      // BlockBee webhook. Custom params (order_id, nonce) are echoed in the query string.
      const orderId = q.get('order_id') || q.get('orderId')
      const nonce = q.get('nonce')
      let body = {}
      const ct = request.headers.get('content-type') || ''
      try {
        if (ct.includes('application/json')) body = await request.json()
        else { const fd = await request.formData(); fd.forEach((v, k) => { body[k] = v }) }
      } catch (e) { body = {} }
      const oid = orderId || body.order_id
      if (!oid) return new Response('*ok*', { status: 200 })
      const order = await db.collection('orders').findOne({ orderId: oid })
      if (!order) return new Response('*ok*', { status: 200 })
      // Bind: nonce must match the one we generated for this order
      if (order.nonce && nonce && String(nonce) !== String(order.nonce)) {
        return new Response('Invalid nonce', { status: 401 })
      }
      // Authoritative confirmation: re-fetch payment state from BlockBee using our API key
      if (order.status !== 'paid') {
        await reconcileBlockbeeOrder(db, order)
      }
      return new Response('*ok*', { status: 200, headers: { 'content-type': 'text/plain' } })
    }

    // dev/testing helper: mark an order paid without live provider (only when crypto NOT configured)
    if (route === '/payments/simulate' && method === 'POST') {
      if (blockbeeConfigured()) return json({ error: 'Disabled while live crypto is configured' }, 403)
      const user = await getUser(request, db)
      if (!user) return json({ error: 'Unauthorized' }, 401)
      const b = await request.json()
      const order = await db.collection('orders').findOne({ orderId: b.orderId, buyerId: user.id })
      if (!order) return json({ error: 'Order not found' }, 404)
      await db.collection('orders').updateOne({ orderId: order.orderId }, { $set: { status: 'paid', paidAt: new Date() } })
      await fulfillListing(db, order.listingId)
      await notify(db, user.id, `Payment confirmed! You now own ${order.item.name}.`, 'success')
      return json({ ok: true, status: 'paid' })
    }

    // ---------- WISHLIST ----------
    if (route === '/wishlist' && method === 'GET') {
      const user = await getUser(request, db); if (!user) return json({ error: 'Unauthorized' }, 401)
      const w = await db.collection('wishlist').find({ userId: user.id }).toArray()
      const items = await db.collection('items').find({ id: { $in: w.map(x => x.itemId) } }).toArray()
      return json({ items: items.map(clean) })
    }
    if (route === '/wishlist' && method === 'POST') {
      const user = await getUser(request, db); if (!user) return json({ error: 'Unauthorized' }, 401)
      const wishRl = await rateLimit(db, `wishlist:${user.id}`, { max: 60, windowMs: 60 * 60 * 1000 })
      if (!wishRl.allowed) return tooMany(wishRl.retryAfterSec)
      const b = await request.json()
      const existing = await db.collection('wishlist').findOne({ userId: user.id, itemId: b.itemId })
      if (existing) { await db.collection('wishlist').deleteOne({ userId: user.id, itemId: b.itemId }); return json({ added: false }) }
      await db.collection('wishlist').insertOne({ id: uuidv4(), userId: user.id, itemId: b.itemId, createdAt: new Date() })
      return json({ added: true })
    }
    if (route.startsWith('/wishlist/') && method === 'DELETE') {
      const user = await getUser(request, db); if (!user) return json({ error: 'Unauthorized' }, 401)
      await db.collection('wishlist').deleteOne({ userId: user.id, itemId: path[1] })
      return json({ success: true })
    }

    // ---------- REPORTS ----------
    if (route === '/reports' && method === 'POST') {
      const user = await getUser(request, db); if (!user) return json({ error: 'Unauthorized' }, 401)
      const reportRl = await rateLimit(db, `report:${user.id}`, { max: 10, windowMs: 60 * 60 * 1000 })
      if (!reportRl.allowed) return tooMany(reportRl.retryAfterSec)
      const b = await request.json()
      const report = { id: uuidv4(), listingId: b.listingId, reporterId: user.id, reporterName: user.username, reason: b.reason || 'Suspicious', status: 'open', createdAt: new Date() }
      await db.collection('reports').insertOne(report)
      return json({ report: clean(report) })
    }

    // ---------- NOTIFICATIONS ----------
    if (route === '/notifications' && method === 'GET') {
      const user = await getUser(request, db); if (!user) return json({ error: 'Unauthorized' }, 401)
      const n = await db.collection('notifications').find({ userId: user.id }).sort({ createdAt: -1 }).limit(50).toArray()
      return json({ notifications: n.map(clean) })
    }
    if (route === '/notifications/read' && method === 'POST') {
      const user = await getUser(request, db); if (!user) return json({ error: 'Unauthorized' }, 401)
      await db.collection('notifications').updateMany({ userId: user.id }, { $set: { read: true } })
      return json({ success: true })
    }

    // ---------- SUPPORT CHAT (buyer side; works for logged-in users and guests) ----------
    // Guests are identified by a random id the browser generates and remembers in
    // localStorage — good enough to keep a guest's thread private without requiring login.
    if (route === '/chat/start' && method === 'POST') {
      const chatStartRl = await rateLimit(db, `chatstart:${ip}`, { max: 15, windowMs: 60 * 60 * 1000 })
      if (!chatStartRl.allowed) return tooMany(chatStartRl.retryAfterSec)
      const user = await getUser(request, db)
      const b = await request.json().catch(() => ({}))
      const guestId = !user && b.guestId ? String(b.guestId).slice(0, 64) : null
      if (!user && !guestId) return json({ error: 'Missing guestId' }, 400)
      const identity = user ? { userId: user.id } : { guestId }
      // Guests need a CAPTCHA to open a brand-new thread (their "first message" gate) —
      // logged-in users already passed one at signup/login, and resuming an existing open
      // thread doesn't need one again.
      if (!user) {
        const existing = await db.collection('chatThreads').findOne({ ...identity, status: { $ne: 'closed' } })
        if (!existing && !(await verifyCaptcha(db, b.captchaId, b.captchaAnswer))) {
          return json({ error: 'Incorrect CAPTCHA — please try again.', captchaRequired: true }, 400)
        }
      }
      // Atomic find-or-create: two near-simultaneous /chat/start calls for the same
      // identity (e.g. React effects double-firing) must not create two separate threads.
      const now = new Date()
      const result = await db.collection('chatThreads').findOneAndUpdate(
        { ...identity, status: { $ne: 'closed' } },
        { $setOnInsert: { id: uuidv4(), ...identity, buyerName: user ? user.username : 'Guest', status: 'open', unreadForAdmin: false, unreadForUser: false, createdAt: now, lastMessageAt: now } },
        { upsert: true, returnDocument: 'after' }
      )
      const thread = result && result.value ? result.value : result
      return json({ threadId: thread.id })
    }
    if (route.startsWith('/chat/') && route.endsWith('/messages') && method === 'GET') {
      const threadId = path[1]
      const thread = await db.collection('chatThreads').findOne({ id: threadId })
      if (!thread) return json({ error: 'Not found' }, 404)
      const user = await getUser(request, db)
      const guestId = q.get('guestId')
      const owns = (user && thread.userId === user.id) || (!user && guestId && thread.guestId === guestId)
      if (!owns) return json({ error: 'Forbidden' }, 403)
      await db.collection('chatThreads').updateOne({ id: threadId }, { $set: { unreadForUser: false } })
      const messages = await db.collection('chatMessages').find({ threadId }).sort({ createdAt: 1 }).toArray()
      return json({ messages: messages.map(clean), status: thread.status })
    }
    if (route.startsWith('/chat/') && route.endsWith('/messages') && method === 'POST') {
      const threadId = path[1]
      const thread = await db.collection('chatThreads').findOne({ id: threadId })
      if (!thread) return json({ error: 'Not found' }, 404)
      const user = await getUser(request, db)
      const b = await request.json().catch(() => ({}))
      const guestId = b.guestId ? String(b.guestId).slice(0, 64) : null
      const owns = (user && thread.userId === user.id) || (!user && guestId && thread.guestId === guestId)
      if (!owns) return json({ error: 'Forbidden' }, 403)
      const msgRl = await rateLimit(db, `chatmsg:${user ? user.id : guestId}`, { max: 20, windowMs: 10 * 60 * 1000 })
      if (!msgRl.allowed) return tooMany(msgRl.retryAfterSec)
      const text = String(b.text || '').trim().slice(0, 2000)
      if (!text) return json({ error: 'Empty message' }, 400)
      const msg = { id: uuidv4(), threadId, sender: 'user', text, createdAt: new Date() }
      await db.collection('chatMessages').insertOne(msg)
      await db.collection('chatThreads').updateOne({ id: threadId }, { $set: { unreadForAdmin: true, lastMessageAt: new Date(), status: 'open' } })
      return json({ message: clean(msg) })
    }

    // ---------- ADMIN ----------
    if (route.startsWith('/admin/')) {
      const user = await getUser(request, db)
      if (!user || !user.isAdmin) return json({ error: 'Admin only' }, 403)

      // ----- Discord Dashboard (secret link + admin login + 2FA) -----
      // 2FA is either a server-generated one-time code (legacy, shown in the Admin Console —
      // fine, but visible in the same browser session) or, once set up, a real TOTP code from
      // an authenticator app (Google Authenticator etc.) that the server never sees or stores
      // in plaintext form — only the shared secret used to verify it.
      if (route === '/admin/dashboard/session' && method === 'POST') {
        const base = requestOrigin(request)
        const slug = process.env.ADMIN_DASHBOARD_SECRET || ''
        const url = `${base}/admin/discord-dashboard/${slug}`
        if (user.totpEnabled) return json({ url, totpRequired: true })
        await db.collection('dashboardCodes').deleteMany({ adminId: user.id }) // rotate: delete previous codes
        const code = String(Math.floor(100000 + Math.random() * 900000)) // 6-digit one-time code
        const now = new Date()
        const expiresAt = new Date(now.getTime() + 10 * 60 * 1000) // 10 min
        await db.collection('dashboardCodes').insertOne({ id: uuidv4(), adminId: user.id, code, used: false, createdAt: now, expiresAt })
        return json({ code, expiresAt, url })
      }
      if (route === '/admin/dashboard/verify' && method === 'POST') {
        const b = await request.json()
        const slug = (b.slug || '').toString()
        const code = (b.code || '').toString().trim()
        if (!process.env.ADMIN_DASHBOARD_SECRET || slug !== process.env.ADMIN_DASHBOARD_SECRET) return json({ error: 'Invalid dashboard link' }, 403)
        if (user.totpEnabled) {
          if (!verifyTotpEncrypted(user.totpSecret, code)) return json({ error: 'Invalid authenticator code' }, 403)
          return json({ ok: true })
        }
        const rec = await db.collection('dashboardCodes').findOne({ adminId: user.id, code, used: false })
        if (!rec) return json({ error: 'Invalid or expired code' }, 403)
        if (new Date(rec.expiresAt) < new Date()) { await db.collection('dashboardCodes').deleteOne({ id: rec.id }); return json({ error: 'Code expired' }, 403) }
        await db.collection('dashboardCodes').deleteOne({ id: rec.id }) // single-use -> delete
        return json({ ok: true })
      }
      // ----- Authenticator app (TOTP) setup -----
      if (route === '/admin/dashboard/totp/status' && method === 'GET') {
        return json({ enabled: !!user.totpEnabled })
      }
      if (route === '/admin/dashboard/totp/setup' && method === 'POST') {
        const secret = genTotpSecret()
        await db.collection('users').updateOne({ id: user.id }, { $set: { totpPendingSecret: encryptSecret(secret) } })
        const otpauthUrl = totpAuthUrl(secret, user.email || user.username, 'Robloot Admin')
        const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 })
        return json({ secret, otpauthUrl, qrDataUrl })
      }
      if (route === '/admin/dashboard/totp/confirm' && method === 'POST') {
        const b = await request.json()
        const code = (b.code || '').toString().trim()
        if (!user.totpPendingSecret) return json({ error: 'Start setup first' }, 400)
        if (!verifyTotpEncrypted(user.totpPendingSecret, code)) return json({ error: 'That code did not match — check your authenticator app and try again' }, 400)
        await db.collection('users').updateOne({ id: user.id }, { $set: { totpSecret: user.totpPendingSecret, totpEnabled: true }, $unset: { totpPendingSecret: '' } })
        await db.collection('dashboardCodes').deleteMany({ adminId: user.id }) // no more use for the legacy code
        return json({ ok: true })
      }
      if (route === '/admin/dashboard/totp/disable' && method === 'POST') {
        const b = await request.json()
        const code = (b.code || '').toString().trim()
        if (!user.totpEnabled) return json({ error: 'Authenticator is not enabled' }, 400)
        if (!verifyTotpEncrypted(user.totpSecret, code)) return json({ error: 'Invalid authenticator code' }, 403)
        await db.collection('users').updateOne({ id: user.id }, { $unset: { totpSecret: '', totpEnabled: '', totpPendingSecret: '' } })
        return json({ ok: true })
      }
      if (route === '/admin/dashboard/overview' && method === 'GET') {
        const orders = await db.collection('orders').find({}).sort({ createdAt: -1 }).toArray()
        const paid = orders.filter(o => o.status === 'paid')
        const pending = orders.filter(o => o.status === 'pending_payment')
        const cfg = await db.collection('settings').findOne({ id: 'botConfig' })
        const botConfigured = !!(cfg && cfg.discordBotToken)
        const accountsCount = await db.collection('accounts').countDocuments({})
        const toycodesCount = await db.collection('toycodes').countDocuments({})
        return json({
          stats: { total: orders.length, paid: paid.length, pending: pending.length, revenue: paid.reduce((a, o) => a + (o.amountUsd || 0), 0), accounts: accountsCount, toycodes: toycodesCount },
          botConfigured, botOnline: !!(cfg && cfg.botOnline), robloxBot: 'voIIium',
          orders: orders.slice(0, 50).map(clean)
        })
      }
      // ---------- Analytics ----------
      if (route === '/admin/dashboard/analytics/revenue' && method === 'GET') {
        const range = q.get('range') || '3m'
        const months = monthRangeKeys(range)
        const { start } = monthBounds(months[0])
        const paidOrders = await db.collection('orders').find({ status: 'paid', paidAt: { $gte: start } }).toArray()
        const byMonth = {}
        for (const m of months) byMonth[m] = { revenue: 0, orders: 0 }
        for (const o of paidOrders) {
          const d = new Date(o.paidAt || o.createdAt)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          if (byMonth[key]) { byMonth[key].revenue += Number(o.amountUsd) || 0; byMonth[key].orders += 1 }
        }
        const series = months.map(m => ({ month: m, revenue: Math.round(byMonth[m].revenue * 100) / 100, orders: byMonth[m].orders }))

        let monthDetail = null
        const qm = q.get('month')
        if (qm) {
          const { start: ms, end: me } = monthBounds(qm)
          const inMonth = await db.collection('orders').find({ status: 'paid', paidAt: { $gte: ms, $lt: me } }).toArray()
          monthDetail = { month: qm, revenue: Math.round(inMonth.reduce((a, o) => a + (Number(o.amountUsd) || 0), 0) * 100) / 100, orders: inMonth.length }
        }
        return json({ range, series, month: monthDetail })
      }
      if (route === '/admin/dashboard/analytics/users' && method === 'GET') {
        const range = q.get('range') || '3m'
        const months = monthRangeKeys(range)
        const { start } = monthBounds(months[0])
        const total = await db.collection('users').countDocuments({})
        const recent = await db.collection('users').find({ createdAt: { $gte: start } }).toArray()
        const byMonth = {}
        for (const m of months) byMonth[m] = 0
        for (const u of recent) {
          const d = new Date(u.createdAt)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          if (key in byMonth) byMonth[key]++
        }
        const series = months.map(m => ({ month: m, signups: byMonth[m] }))
        return json({ range, total, series })
      }
      // Timeframe-filtered, paginated order browser (Orders tab)
      if (route === '/admin/dashboard/orders' && method === 'GET') {
        const timeframe = q.get('timeframe') || 'all'
        const page = Math.max(1, parseInt(q.get('page')) || 1)
        const pageSize = Math.min(50, Math.max(1, parseInt(q.get('pageSize')) || 10))
        const now = new Date()
        const filter = {}
        if (timeframe === 'today') {
          filter.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }
        } else if (timeframe === 'yesterday') {
          filter.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), $lt: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }
        } else if (timeframe === 'week') {
          filter.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7) }
        } else if (timeframe === 'date' && q.get('date')) {
          const [y, mo, da] = q.get('date').split('-').map(Number)
          filter.createdAt = { $gte: new Date(y, mo - 1, da), $lt: new Date(y, mo - 1, da + 1) }
        } else if (timeframe === 'month' && q.get('month')) {
          const { start, end } = monthBounds(q.get('month'))
          filter.createdAt = { $gte: start, $lt: end }
        } else if (timeframe === 'year' && q.get('year')) {
          const y = Number(q.get('year'))
          filter.createdAt = { $gte: new Date(y, 0, 1), $lt: new Date(y + 1, 0, 1) }
        }
        const total = await db.collection('orders').countDocuments(filter)
        const orders = await db.collection('orders').find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray()
        return json({ orders: orders.map(clean), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
      }
      if (route === '/admin/dashboard/bot-config' && method === 'GET') {
        const cfg = (await db.collection('settings').findOne({ id: 'botConfig' })) || {}
        const mask = v => v ? ('••••••' + String(v).slice(-4)) : ''
        return json({ config: {
          discordBotTokenSet: !!cfg.discordBotToken, discordBotTokenMasked: mask(cfg.discordBotToken),
          discordClientId: cfg.discordClientId || '', discordGuildId: cfg.discordGuildId || '', discordChannelId: cfg.discordChannelId || '',
          discordPublicKeySet: !!process.env.DISCORD_PUBLIC_KEY, botSharedSecretSet: !!process.env.BOT_SHARED_SECRET,
          robloxEnabled: !!cfg.robloxEnabled, botOnline: !!cfg.botOnline, robloxBot: 'voIIium', dashboardSecretSet: !!process.env.ADMIN_DASHBOARD_SECRET
        } })
      }
      if (route === '/admin/dashboard/bot-config' && method === 'POST') {
        const b = await request.json()
        const set = { id: 'botConfig', updatedAt: new Date() }
        if (b.discordBotToken) set.discordBotToken = b.discordBotToken.toString()
        if (b.discordClientId != null) set.discordClientId = b.discordClientId.toString()
        if (b.discordGuildId != null) set.discordGuildId = b.discordGuildId.toString()
        if (b.discordChannelId != null) set.discordChannelId = b.discordChannelId.toString()
        if (b.robloxEnabled != null) set.robloxEnabled = !!b.robloxEnabled
        if (b.botOnline != null) set.botOnline = !!b.botOnline
        await db.collection('settings').updateOne({ id: 'botConfig' }, { $set: set }, { upsert: true })
        return json({ success: true })
      }
      if (route === '/admin/dashboard/fulfill' && method === 'POST') {
        const b = await request.json()
        const order = await db.collection('orders').findOne({ orderId: b.orderId })
        if (!order) return json({ error: 'Order not found' }, 404)
        const cfg = (await db.collection('settings').findOne({ id: 'botConfig' })) || {}
        if (!cfg.robloxEnabled || !robloxCookie()) return json({ error: 'Roblox bot is not configured yet. Add the bot keys and enable it first.', pending: true }, 400)
        // Bot trade automation will be wired here once keys are provided.
        return json({ error: 'Roblox trade automation is not enabled on this build yet.', pending: true }, 501)
      }
      // ----- Digital goods inventory: accounts (profiles) + toy codes -----
      if (route === '/admin/dashboard/accounts' && method === 'GET') {
        return json({ accounts: (await db.collection('accounts').find({}).sort({ createdAt: -1 }).toArray()).map(clean) })
      }
      if (route === '/admin/dashboard/accounts' && method === 'POST') {
        const b = await request.json()
        if (!b.title || !b.username || !b.password) return json({ error: 'Title, username and password are required' }, 400)
        const acc = { id: uuidv4(), type: 'account', title: b.title.toString().trim(), description: (b.description || '').toString().trim(), price: Number(b.price) || 0, imageUrl: (b.imageUrl || '').toString().trim(), credentials: { username: b.username.toString(), password: b.password.toString(), email: (b.email || '').toString(), notes: (b.notes || '').toString() }, status: 'available', claimOrderNumber: null, createdAt: new Date() }
        await db.collection('accounts').insertOne(acc)
        return json({ account: clean(acc) })
      }
      if (route.startsWith('/admin/dashboard/accounts/') && method === 'DELETE') {
        await db.collection('accounts').deleteOne({ id: path[3] })
        return json({ success: true })
      }
      // Import a real Roblox account by UID or profile link: pull profile + inventory
      // (limiteds, regular items incl. animations, game passes) into a draft record with
      // its own page. Nothing is public yet — status stays 'draft' until listed for sale.
      if (route === '/admin/dashboard/accounts/import' && method === 'POST') {
        const b = await request.json().catch(() => ({}))
        const input = (b.input || '').toString().trim()
        if (!input) return json({ error: 'Enter a Roblox username, ID, or profile link' }, 400)
        let profile
        try { profile = await robloxProfile(input) }
        catch (e) { return json({ error: e.message || 'Could not find that Roblox account' }, 502) }
        const [limiteds, items, gamepasses] = await Promise.all([
          robloxLimiteds(profile.id).catch(() => []),
          robloxRegularItems(profile.id).catch(() => []),
          robloxGamePasses(profile.id).catch(() => ({ games: [], passes: [] })),
        ])
        const acc = {
          id: uuidv4(), type: 'account', status: 'draft',
          title: profile.displayName || profile.name, description: '', price: 0, imageUrl: '',
          credentials: { username: profile.name, password: '', email: '', notes: '' },
          robloxUserId: profile.id,
          snapshot: { profile, limiteds, items, gamepasses, fetchedAt: new Date() },
          claimOrderNumber: null, createdAt: new Date(), updatedAt: new Date(),
        }
        await db.collection('accounts').insertOne(acc)
        return json({ account: clean(acc) })
      }
      if (route === '/admin/dashboard/accounts/import' && method !== 'POST') return json({ error: 'Method not allowed' }, 405)
      if (route.startsWith('/admin/dashboard/accounts/') && path[3] && path[3] !== 'import' && method === 'GET') {
        const acc = await db.collection('accounts').findOne({ id: path[3] })
        if (!acc) return json({ error: 'Not found' }, 404)
        return json({ account: clean(acc) })
      }
      if (route.startsWith('/admin/dashboard/accounts/') && path[3] && path[3] !== 'import' && method === 'PUT') {
        const acc = await db.collection('accounts').findOne({ id: path[3] })
        if (!acc) return json({ error: 'Not found' }, 404)
        const b = await request.json().catch(() => ({}))
        const set = { updatedAt: new Date() }
        if (b.title != null) set.title = b.title.toString().trim()
        if (b.description != null) set.description = b.description.toString().trim()
        if (b.price != null) set.price = Number(b.price) || 0
        if (b.imageUrl != null) set.imageUrl = b.imageUrl.toString().trim()
        if (b.credentials) set.credentials = {
          username: (b.credentials.username ?? acc.credentials?.username ?? '').toString(),
          password: (b.credentials.password ?? acc.credentials?.password ?? '').toString(),
          email: (b.credentials.email ?? acc.credentials?.email ?? '').toString(),
          notes: (b.credentials.notes ?? acc.credentials?.notes ?? '').toString(),
        }
        if (b.status && ['draft', 'available', 'removed'].includes(b.status)) {
          if (b.status === 'available') {
            const title = (set.title ?? acc.title ?? '').toString().trim()
            const creds = set.credentials || acc.credentials || {}
            if (!title || !creds.username || !creds.password) return json({ error: 'Title, username and password are required before listing' }, 400)
          }
          set.status = b.status
        }
        await db.collection('accounts').updateOne({ id: path[3] }, { $set: set })
        const updated = await db.collection('accounts').findOne({ id: path[3] })
        return json({ account: clean(updated) })
      }
      if (route === '/admin/dashboard/toycodes' && method === 'GET') {
        return json({ toycodes: (await db.collection('toycodes').find({}).sort({ createdAt: -1 }).toArray()).map(clean) })
      }
      if (route === '/admin/dashboard/toycodes' && method === 'POST') {
        const b = await request.json()
        if (!b.title) return json({ error: 'Title is required' }, 400)
        // `code` is optional here — for orders placed through the website, the code is
        // entered per-order after payment (see .../fulfill below), not at listing time.
        const tc = { id: uuidv4(), type: 'toycode', title: b.title.toString().trim(), description: (b.description || '').toString().trim(), price: Number(b.price) || 0, imageUrl: (b.imageUrl || '').toString().trim(), code: (b.code || '').toString().trim(), stock: Math.max(0, parseInt(b.stock) || 1), status: 'available', claimOrderNumber: null, pendingOrders: [], claimedOrders: [], createdAt: new Date() }
        await db.collection('toycodes').insertOne(tc)
        return json({ toycode: clean(tc) })
      }
      if (route.startsWith('/admin/dashboard/toycodes/') && method === 'DELETE') {
        await db.collection('toycodes').deleteOne({ id: path[3] })
        return json({ success: true })
      }
      // List every paid order still waiting on its code, across all toy codes.
      if (route === '/admin/dashboard/toycodes-pending' && method === 'GET') {
        const items = await db.collection('toycodes').find({ 'pendingOrders.code': '' }).toArray()
        const rows = []
        for (const tc of items) {
          for (const p of (tc.pendingOrders || [])) {
            if (!p.code) {
              const order = await db.collection('orders').findOne({ orderCode: p.orderCode })
              rows.push({ toycodeId: tc.id, title: tc.title, orderCode: p.orderCode, discordName: order?.buyerInfo?.discordName || '', createdAt: p.createdAt })
            }
          }
        }
        rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        return json({ pending: rows })
      }
      // Enter the code for one specific paid order (fulfillment happens per-sale, not at listing time)
      if (route.startsWith('/admin/dashboard/toycodes/') && route.endsWith('/fulfill') && method === 'POST') {
        const b = await request.json()
        const code = (b.code || '').toString().trim()
        const orderCode = (b.orderCode || '').toString().trim()
        if (!code || !orderCode) return json({ error: 'code and orderCode are required' }, 400)
        const r = await db.collection('toycodes').updateOne({ id: path[3], 'pendingOrders.orderCode': orderCode }, { $set: { 'pendingOrders.$.code': code } })
        if (r.matchedCount === 0) return json({ error: 'Pending order not found' }, 404)
        return json({ success: true })
      }
      // Assign an available item to an order number so the buyer can /claim it via the Discord bot
      if (route === '/admin/dashboard/assign' && method === 'POST') {
        const b = await request.json()
        const coll = b.type === 'account' ? 'accounts' : b.type === 'toycode' ? 'toycodes' : null
        if (!coll || !b.id || !b.orderNumber) return json({ error: 'type, id and orderNumber are required' }, 400)
        const item = await db.collection(coll).findOne({ id: b.id })
        if (!item) return json({ error: 'Item not found' }, 404)
        await db.collection(coll).updateOne({ id: b.id }, { $set: { status: 'sold', claimOrderNumber: String(b.orderNumber), assignedAt: new Date() } })
        return json({ success: true })
      }

      // Create a throwaway toy code, already assigned to a fresh order number, so the
      // admin can immediately test /claim <orderNumber> in Discord without a real sale.
      if (route === '/admin/dashboard/test-order' && method === 'POST') {
        const orderNumber = `DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
        const tc = {
          id: uuidv4(), type: 'toycode', title: 'Demo Test Order', description: 'Created for bot testing',
          price: 0, imageUrl: '', code: `DEMO-CODE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          status: 'sold', claimOrderNumber: orderNumber, assignedAt: new Date(), createdAt: new Date()
        }
        await db.collection('toycodes').insertOne(tc)
        return json({ orderNumber, title: tc.title, code: tc.code })
      }

      // ----- Discord Embeds (saved rich embeds for /embed) -----
      if (route === '/admin/dashboard/embeds' && method === 'GET') {
        return json({ embeds: (await db.collection('embeds').find({}).sort({ createdAt: -1 }).toArray()).map(clean) })
      }
      if (route === '/admin/dashboard/embeds' && method === 'POST') {
        const b = await request.json()
        const name = (b.name || '').toString().trim()
        if (!name) return json({ error: 'Embed name is required' }, 400)
        if (!(b.title || b.description)) return json({ error: 'Add a title or a description' }, 400)
        const fields = Array.isArray(b.fields)
          ? b.fields.filter(f => f && (f.name || f.value)).slice(0, 5).map(f => ({ name: (f.name || '').toString(), value: (f.value || '').toString(), inline: !!f.inline }))
          : []
        const doc = {
          name, name_lc: name.toLowerCase(),
          title: (b.title || '').toString(), description: (b.description || '').toString(),
          color: (b.color || '').toString(), imageUrl: (b.imageUrl || '').toString(), thumbnailUrl: (b.thumbnailUrl || '').toString(),
          footerText: (b.footerText || '').toString(), authorName: (b.authorName || '').toString(), fields, updatedAt: new Date()
        }
        // Edit by id, else upsert by name (case-insensitive)
        let target = b.id ? await db.collection('embeds').findOne({ id: b.id }) : await db.collection('embeds').findOne({ name_lc: name.toLowerCase() })
        if (target) {
          await db.collection('embeds').updateOne({ id: target.id }, { $set: doc })
          return json({ embed: clean(await db.collection('embeds').findOne({ id: target.id })) })
        }
        const rec = { id: uuidv4(), ...doc, createdAt: new Date() }
        await db.collection('embeds').insertOne(rec)
        return json({ embed: clean(rec) })
      }
      if (route.startsWith('/admin/dashboard/embeds/') && path[4] === 'post' && method === 'POST') {
        const e = await db.collection('embeds').findOne({ id: path[3] })
        if (!e) return json({ error: 'Embed not found' }, 404)
        const cfg = await getBotCfg(db)
        const token = cfg.discordBotToken
        const b = await request.json().catch(() => ({}))
        const channelId = (b.channelId || '').toString().trim() || cfg.discordChannelId
        if (!token) return json({ error: 'Save your Discord bot token first (General tab).' }, 400)
        if (!channelId) return json({ error: 'Set an Orders Channel ID (General tab) or pass a channelId.' }, 400)
        const r = await discordApi(token, 'POST', `/channels/${channelId}/messages`, { embeds: [buildDiscordEmbed(e)] })
        if (!r.ok) return json({ error: `Discord error ${r.status}: ${r.data?.message || JSON.stringify(r.data)}` }, 502)
        return json({ success: true, messageId: r.data?.id })
      }
      if (route.startsWith('/admin/dashboard/embeds/') && method === 'DELETE') {
        await db.collection('embeds').deleteOne({ id: path[3] })
        return json({ success: true })
      }

      // ----- Discord bot: register slash commands + live status -----
      if (route === '/admin/dashboard/register-commands' && method === 'POST') {
        const cfg = await getBotCfg(db)
        const token = cfg.discordBotToken, appId = cfg.discordClientId, guildId = cfg.discordGuildId
        if (!token || !appId || !guildId) return json({ error: 'Save your bot token, Client (Application) ID and Guild (Server) ID first.' }, 400)
        const commands = [
          { name: 'claim', description: 'Claim your paid order (toy code or account login)', type: 1, options: [{ type: 3, name: 'order', description: 'Your order number', required: true }] },
          { name: 'embed', description: 'Post a saved embed to this channel', type: 1, options: [{ type: 3, name: 'name', description: 'Which saved embed to post', required: true, autocomplete: true }] }
        ]
        const r = await discordApi(token, 'PUT', `/applications/${appId}/guilds/${guildId}/commands`, commands)
        if (!r.ok) return json({ error: `Discord error ${r.status}: ${r.data?.message || JSON.stringify(r.data)}` }, 502)
        const names = Array.isArray(r.data) ? r.data.map(c => c.name) : []
        await db.collection('settings').updateOne({ id: 'botConfig' }, { $set: { commandsRegisteredAt: new Date(), commandNames: names } }, { upsert: true })
        return json({ success: true, commands: names })
      }
      if (route === '/admin/dashboard/bot-status' && method === 'GET') {
        const cfg = await getBotCfg(db)
        const token = cfg.discordBotToken
        let tokenValid = false, botUsername = null
        if (token) {
          const r = await discordApi(token, 'GET', '/users/@me')
          if (r.ok) { tokenValid = true; botUsername = r.data?.username ? `${r.data.username}${r.data.discriminator && r.data.discriminator !== '0' ? '#' + r.data.discriminator : ''}` : null }
        }
        let commandsRegistered = false, commands = []
        if (token && cfg.discordClientId && cfg.discordGuildId) {
          const rc = await discordApi(token, 'GET', `/applications/${cfg.discordClientId}/guilds/${cfg.discordGuildId}/commands`)
          if (rc.ok && Array.isArray(rc.data)) { commands = rc.data.map(c => c.name); commandsRegistered = commands.length > 0 }
        }
        const base = process.env.NEXT_PUBLIC_BASE_URL || ''
        const endpointUrl = `${base}/api/discord/interactions`
        let endpointConfigured = false, currentEndpoint = null
        if (token) {
          const app = await discordApi(token, 'GET', '/applications/@me')
          if (app.ok) { currentEndpoint = app.data?.interactions_endpoint_url || null; endpointConfigured = currentEndpoint === endpointUrl }
        }
        const publicKeySet = !!process.env.DISCORD_PUBLIC_KEY
        return json({
          tokenValid, botUsername, publicKeySet, commandsRegistered, commands,
          endpointConfigured, currentEndpoint,
          tokenSet: !!token, clientId: cfg.discordClientId || '', guildId: cfg.discordGuildId || '', channelId: cfg.discordChannelId || '',
          endpointUrl,
          ready: tokenValid && publicKeySet && commandsRegistered && endpointConfigured
        })
      }

      // ----- Bot "start" boot sequence -> returns console log lines -----
      if (route === '/admin/dashboard/bot-start' && method === 'POST') {
        const logs = []
        const L = (level, msg) => logs.push({ level, msg, t: new Date().toISOString() })
        let errors = 0
        const cfg = await getBotCfg(db)
        const token = cfg.discordBotToken
        L('info', 'Booting Discord bot service…')
        L('info', 'Loading configuration from database…')

        // 1) token present + valid
        let botUser = null
        if (!token) {
          L('error', 'No bot token saved. Go to General → Secrets & keys and paste your Discord bot token, then Save.'); errors++
        } else {
          L('info', 'Authenticating with Discord (GET /users/@me)…')
          const r = await discordApi(token, 'GET', '/users/@me')
          if (r.ok) {
            botUser = r.data
            L('success', `Authenticated as ${r.data.username}${r.data.discriminator && r.data.discriminator !== '0' ? '#' + r.data.discriminator : ''} (id ${r.data.id}).`)
          } else if (r.status === 401) {
            L('error', 'Bot token is invalid or expired (Discord 401). Reset the token in the Developer Portal → Bot → Reset Token, then re-save it here.'); errors++
          } else {
            L('error', `Could not authenticate (Discord ${r.status}: ${r.data?.message || 'unknown'}).`); errors++
          }
        }

        // 2) public key
        if (process.env.DISCORD_PUBLIC_KEY) L('success', 'DISCORD_PUBLIC_KEY is configured (interaction signatures can be verified).')
        else { L('error', 'DISCORD_PUBLIC_KEY is not set on the server. Slash commands will be rejected (503). Provide your app Public Key.'); errors++ }

        // 3) ids present
        if (!cfg.discordClientId) { L('error', 'Client (Application) ID is missing. Add it in General → Secrets & keys.'); errors++ }
        if (!cfg.discordGuildId) { L('error', 'Guild (Server) ID is missing. Add it in General → Secrets & keys.'); errors++ }

        // 4) bot is in the guild
        if (token && cfg.discordGuildId) {
          L('info', `Checking guild membership (GET /guilds/${cfg.discordGuildId})…`)
          const g = await discordApi(token, 'GET', `/guilds/${cfg.discordGuildId}`)
          if (g.ok) L('success', `Bot is in server "${g.data?.name || cfg.discordGuildId}".`)
          else if (g.status === 403 || g.status === 404) {
            L('error', `Bot is not in server ${cfg.discordGuildId} (Discord ${g.status}). Invite it: https://discord.com/oauth2/authorize?client_id=${cfg.discordClientId || 'APP_ID'}&scope=bot+applications.commands&permissions=277025508352`); errors++
          } else L('warn', `Could not confirm guild access (Discord ${g.status}: ${g.data?.message || 'unknown'}).`)
        }

        // 5) register slash commands
        if (token && cfg.discordClientId && cfg.discordGuildId) {
          L('info', 'Registering slash commands (/claim, /embed)…')
          const commands = [
            { name: 'claim', description: 'Claim your paid order (toy code or account login)', type: 1, options: [{ type: 3, name: 'order', description: 'Your order number', required: true }] },
            { name: 'embed', description: 'Post a saved embed to this channel', type: 1, options: [{ type: 3, name: 'name', description: 'Which saved embed to post', required: true, autocomplete: true }] }
          ]
          const rr = await discordApi(token, 'PUT', `/applications/${cfg.discordClientId}/guilds/${cfg.discordGuildId}/commands`, commands)
          if (rr.ok && Array.isArray(rr.data)) {
            L('success', `Registered ${rr.data.length} command(s): ${rr.data.map(c => '/' + c.name).join(', ')}.`)
            await db.collection('settings').updateOne({ id: 'botConfig' }, { $set: { commandsRegisteredAt: new Date(), commandNames: rr.data.map(c => c.name) } }, { upsert: true })
          } else { L('error', `Failed to register commands (Discord ${rr.status}: ${rr.data?.message || JSON.stringify(rr.data)}).`); errors++ }
        } else {
          L('warn', 'Skipping command registration until token + Client ID + Guild ID are all set.')
        }

        // 6) channel access
        if (token && cfg.discordChannelId) {
          L('info', `Checking channel access (GET /channels/${cfg.discordChannelId})…`)
          const c = await discordApi(token, 'GET', `/channels/${cfg.discordChannelId}`)
          if (c.ok) L('success', `Channel #${c.data?.name || cfg.discordChannelId} is accessible.`)
          else { L('error', `Cannot access channel ${cfg.discordChannelId} (Discord ${c.status}: ${c.data?.message || 'unknown'}). Check the ID and that the bot can view it.`); errors++ }
        } else if (token) {
          L('warn', 'No Orders Channel ID set — "Post to channel" for embeds will not work until you add one.')
        }

        // 7) Set + verify the interactions endpoint URL on the Discord application
        const base = process.env.NEXT_PUBLIC_BASE_URL || ''
        const endpoint = `${base}/api/discord/interactions`
        if (token && process.env.DISCORD_PUBLIC_KEY) {
          L('info', 'Reading application settings (GET /applications/@me)…')
          const app = await discordApi(token, 'GET', '/applications/@me')
          const current = app.ok ? (app.data?.interactions_endpoint_url || null) : undefined
          if (app.ok) L('info', `Current interactions endpoint: ${current || '(none set)'}`)
          if (current === endpoint) {
            L('success', 'Interactions endpoint already set to this server. Slash commands are live.')
          } else {
            L('info', `Setting interactions endpoint to ${endpoint} …`)
            const patch = await discordApi(token, 'PATCH', '/applications/@me', { interactions_endpoint_url: endpoint })
            if (patch.ok) {
              L('success', 'Interactions endpoint set AND verified by Discord. /embed and /claim are now LIVE.')
            } else {
              errors++
              const msg = patch.data?.message || JSON.stringify(patch.data)
              if (/interactions_endpoint_url/i.test(JSON.stringify(patch.data)) || patch.status === 400) {
                L('error', `Discord could not verify the endpoint (${patch.status}: ${msg}). This usually means DISCORD_PUBLIC_KEY does not match this Discord app. Copy the Public Key from Developer Portal → General Information and make sure it matches.`)
              } else {
                L('error', `Failed to set interactions endpoint (Discord ${patch.status}: ${msg}). You can set it manually in Developer Portal → General Information → Interactions Endpoint URL: ${endpoint}`)
              }
            }
          }
        } else {
          L('warn', `Cannot set interactions endpoint until token + DISCORD_PUBLIC_KEY are ready. URL to use: ${endpoint}`)
        }

        const ready = errors === 0 && !!botUser && !!process.env.DISCORD_PUBLIC_KEY
        if (ready) L('success', '✅ Bot is READY. Try /embed and /claim in your server.')
        else L('error', `Startup finished with ${errors} error(s). Fix the ERROR lines above and press Start again.`)

        return json({ ok: ready, errors, logs })
      }



      // ----- Reviews management -----
      if (route === '/admin/reviews/settings' && method === 'POST') {
        const b = await request.json()
        const doc = (await db.collection('settings').findOne({ id: 'reviews' })) || {}
        const sbs = { ebay: 0, eldorado: 0, sellauth: 0, g2g: 0, playerauctions: 0, other: 0, ...(doc.salesBySource || {}) }
        if (!doc.salesBySource && doc.totalSales) sbs.other = doc.totalSales // migrate legacy
        const keys = ['ebay', 'eldorado', 'sellauth', 'g2g', 'playerauctions', 'other']
        if (b.salesBySource && typeof b.salesBySource === 'object') {
          for (const k of keys) if (b.salesBySource[k] != null) sbs[k] = Math.max(0, Math.floor(Number(b.salesBySource[k]) || 0))
        } else if (b.source) {
          const k = keys.includes(b.source) ? b.source : 'other'
          sbs[k] = Math.max(0, Math.floor(Number(b.sales) || 0))
        } else if (b.totalSales != null) {
          sbs.other = Math.max(0, Math.floor(Number(b.totalSales) || 0))
        }
        const totalSales = keys.reduce((a, k) => a + sbs[k], 0)
        await db.collection('settings').updateOne({ id: 'reviews' }, { $set: { id: 'reviews', salesBySource: sbs, totalSales, updatedAt: new Date() } }, { upsert: true })
        return json({ success: true, salesBySource: sbs, totalSales })
      }
      if (route === '/admin/reviews' && method === 'POST') {
        const b = await request.json()
        if (!b.comment || !b.comment.toString().trim()) return json({ error: 'Comment is required' }, 400)
        const review = {
          id: uuidv4(), author: (b.author || 'eBay buyer').toString().trim(),
          comment: b.comment.toString().trim(), rating: (b.rating || 'positive').toString(),
          item: (b.item || '').toString().trim(), period: (b.period || '').toString().trim(),
          source: (b.source || 'manual').toString(), ebayFeedbackId: b.ebayFeedbackId || null,
          pinned: !!b.pinned, createdAt: new Date()
        }
        await db.collection('reviews').insertOne(review)
        return json({ review: clean(review) })
      }
      if (route.startsWith('/admin/reviews/') && method === 'DELETE') {
        await db.collection('reviews').deleteOne({ id: path[2] })
        return json({ success: true })
      }
      if (route === '/admin/reviews/import-ebay' && method === 'POST') {
        const ebayRl = await rateLimit(db, `ebayimport:${user.id}`, { max: 20, windowMs: 60 * 60 * 1000 })
        if (!ebayRl.allowed) return tooMany(ebayRl.retryAfterSec)
        const b = await request.json()
        if (!b.url || !/ebay\.com\/fdbk\/feedback_profile\//i.test(b.url)) return json({ error: 'Enter a valid eBay feedback profile URL (ebay.com/fdbk/feedback_profile/USERNAME)' }, 400)
        let parsed
        try { parsed = await fetchEbayFeedback(b.url) } catch (e) { return json({ error: e.message || 'Could not read eBay feedback' }, 502) }
        let imported = 0, skipped = 0
        for (const it of parsed.items) {
          const exists = await db.collection('reviews').findOne({ ebayFeedbackId: it.ebayFeedbackId })
          if (exists) { skipped++; continue }
          await db.collection('reviews').insertOne({ id: uuidv4(), author: it.author || 'eBay buyer', comment: it.comment, rating: it.rating, item: it.item, period: it.period, source: 'ebay', ebayFeedbackId: it.ebayFeedbackId, pinned: false, createdAt: new Date() })
          imported++
        }
        // Optionally set eBay sales to the detected eBay feedback score (combined into total)
        if (parsed.feedbackScore != null && b.setTotalSales) {
          const doc = (await db.collection('settings').findOne({ id: 'reviews' })) || {}
          const sbs = { ebay: 0, eldorado: 0, sellauth: 0, g2g: 0, playerauctions: 0, other: 0, ...(doc.salesBySource || {}) }
          if (!doc.salesBySource && doc.totalSales) sbs.other = doc.totalSales
          sbs.ebay = parsed.feedbackScore
          const totalSales = ['ebay', 'eldorado', 'sellauth', 'g2g', 'playerauctions', 'other'].reduce((a, k) => a + (Number(sbs[k]) || 0), 0)
          await db.collection('settings').updateOne({ id: 'reviews' }, { $set: { id: 'reviews', salesBySource: sbs, totalSales, updatedAt: new Date() } }, { upsert: true })
        }
        return json({ imported, skipped, detected: parsed.items.length, feedbackScore: parsed.feedbackScore, handle: parsed.handle })
      }
      if (route === '/admin/reviews/import-eldorado' && method === 'POST') {
        const eldoRl = await rateLimit(db, `eldoradoimport:${user.id}`, { max: 20, windowMs: 60 * 60 * 1000 })
        if (!eldoRl.allowed) return tooMany(eldoRl.retryAfterSec)
        const b = await request.json()
        if (!b.url || !/eldorado\.gg\/users\//i.test(b.url)) return json({ error: 'Enter a valid Eldorado profile URL (eldorado.gg/users/USERNAME/reviews)' }, 400)
        let parsed
        try { parsed = await fetchEldoradoFeedback(b.url) } catch (e) { return json({ error: e.message || 'Could not read Eldorado reviews' }, 502) }
        let imported = 0, skipped = 0
        for (const it of parsed.items) {
          const exists = await db.collection('reviews').findOne({ eldoradoReviewId: it.sourceId })
          if (exists) { skipped++; continue }
          await db.collection('reviews').insertOne({ id: uuidv4(), author: it.author || 'Eldorado buyer', comment: it.comment, rating: it.rating, item: it.item, period: it.period, source: 'eldorado', eldoradoReviewId: it.sourceId, pinned: false, createdAt: new Date() })
          imported++
        }
        // ratingCount (a real count, not the positivePct percentage) into the sales tracker —
        // same convention as eBay's import above.
        if (parsed.ratingCount != null && b.setTotalSales) {
          const doc = (await db.collection('settings').findOne({ id: 'reviews' })) || {}
          const sbs = { ebay: 0, eldorado: 0, sellauth: 0, g2g: 0, playerauctions: 0, other: 0, ...(doc.salesBySource || {}) }
          if (!doc.salesBySource && doc.totalSales) sbs.other = doc.totalSales
          sbs.eldorado = parsed.ratingCount
          const totalSales = ['ebay', 'eldorado', 'sellauth', 'g2g', 'playerauctions', 'other'].reduce((a, k) => a + (Number(sbs[k]) || 0), 0)
          await db.collection('settings').updateOne({ id: 'reviews' }, { $set: { id: 'reviews', salesBySource: sbs, totalSales, updatedAt: new Date() } }, { upsert: true })
        }
        return json({ imported, skipped, detected: parsed.items.length, ratingCount: parsed.ratingCount, positivePct: parsed.positivePct, handle: parsed.handle })
      }

      if (route === '/admin/roblox-lookup' && method === 'POST') {
        const rbxAdminRl = await rateLimit(db, `robloxadmin:${user.id}`, { max: 100, windowMs: 60 * 60 * 1000 })
        if (!rbxAdminRl.allowed) return tooMany(rbxAdminRl.retryAfterSec)
        const b = await request.json()
        try {
          const data = await robloxLookup(b.url)
          return json({ item: data })
        } catch (e) {
          return json({ error: e.message || 'Roblox lookup failed', roblox: true }, 502)
        }
      }

      if (route === '/admin/stats' && method === 'GET') {
        const [users, listings, orders, reports, items] = await Promise.all([
          db.collection('users').countDocuments(), db.collection('listings').countDocuments(),
          db.collection('orders').countDocuments(), db.collection('reports').countDocuments({ status: 'open' }),
          db.collection('items').countDocuments()
        ])
        const paid = await db.collection('orders').find({ status: 'paid' }).toArray()
        const revenue = paid.reduce((s, o) => s + (o.amountUsd || 0), 0)
        return json({ users, listings, orders, reports, items, revenue })
      }
      if (route === '/admin/users' && method === 'GET') return json({ users: (await db.collection('users').find({}).toArray()).map(clean) })
      if (route.startsWith('/admin/users/') && method === 'DELETE') { await db.collection('users').deleteOne({ id: path[2] }); return json({ success: true }) }

      if (route === '/admin/vendors' && method === 'GET') return json({ vendors: (await db.collection('vendors').find({}).toArray()).map(clean) })
      if (route === '/admin/vendors' && method === 'POST') {
        const b = await request.json()
        if (!b.name) return json({ error: 'Vendor name required' }, 400)
        const vendor = { id: uuidv4(), name: b.name, avatarUrl: b.avatarUrl || `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(b.name)}`, reputation: b.reputation || 5, salesCount: 0, createdAt: new Date() }
        await db.collection('vendors').insertOne(vendor)
        return json({ vendor: clean(vendor) })
      }

      if (route === '/admin/items' && method === 'GET') return json({ items: (await db.collection('items').find({}).sort({ createdAt: -1 }).toArray()).map(clean) })
      if (route === '/admin/items' && method === 'POST') {
        const b = await request.json()
        if (!b.name) return json({ error: 'Item name required' }, 400)
        const item = { id: uuidv4(), name: b.name, description: b.description || '', category: b.category || 'UGC', imageUrl: b.imageUrl || pick(ITEM_IMAGES, Math.floor(Math.random() * ITEM_IMAGES.length)), robloxItemId: b.robloxItemId || null, createdAt: new Date() }
        await db.collection('items').insertOne(item)
        return json({ item: clean(item) })
      }
      if (route.startsWith('/admin/items/') && method === 'DELETE') { await db.collection('items').deleteOne({ id: path[2] }); await db.collection('listings').updateMany({ itemId: path[2] }, { $set: { status: 'removed' } }); return json({ success: true }) }

      if (route === '/admin/listings' && method === 'GET') return json({ listings: (await db.collection('listings').find({}).sort({ createdAt: -1 }).toArray()).map(clean) })
      if (route === '/admin/listings' && method === 'POST') {
        const b = await request.json()
        const price = parseFloat(b.price)
        if (!price || price <= 0) return json({ error: 'Enter a valid USD price' }, 400)
        const stock = Math.max(1, parseInt(b.stock) || 1)

        // Resolve or create the underlying catalog item
        let item
        if (b.itemId) {
          item = await db.collection('items').findOne({ id: b.itemId })
          if (!item) return json({ error: 'Select a valid item' }, 400)
        } else {
          if (!b.name) return json({ error: 'Item name required (import from Roblox first)' }, 400)
          item = {
            id: uuidv4(), name: b.name, description: b.description || '', category: b.category || 'Limiteds',
            imageUrl: b.imageUrl || pick(ITEM_IMAGES, Math.floor(Math.random() * ITEM_IMAGES.length)),
            robloxItemId: b.robloxAssetId || b.assetId || null,
            rap: b.rap ?? null, robuxPrice: b.robuxPrice ?? b.lowestResalePrice ?? null,
            collectibleItemId: b.collectibleItemId || null, createdAt: new Date()
          }
          await db.collection('items').insertOne(item)
        }

        // Resolve vendor: use provided, else default house store
        let vendor = b.vendorId ? await db.collection('vendors').findOne({ id: b.vendorId }) : null
        if (!vendor) vendor = await db.collection('vendors').findOne({ name: 'Robloot Market' }) || await db.collection('vendors').findOne({})
        if (!vendor) return json({ error: 'No store available' }, 400)

        const days = parseInt(b.durationDays) || 30
        const listing = {
          id: uuidv4(), itemId: item.id,
          item: { name: item.name, description: item.description, imageUrl: item.imageUrl, category: item.category, robloxItemId: item.robloxItemId },
          vendorId: vendor.id, sellerName: vendor.name, sellerAvatar: vendor.avatarUrl, sellerRep: vendor.reputation,
          price, currency: 'USD', status: 'active', condition: b.condition || 'Limited',
          stock, soldCount: 0,
          rap: b.rap ?? item.rap ?? null, robuxPrice: b.robuxPrice ?? b.lowestResalePrice ?? item.robuxPrice ?? null,
          robloxAssetId: item.robloxItemId || null,
          popularity: 0, expiresAt: new Date(Date.now() + days * 86400000), createdAt: new Date()
        }
        await db.collection('listings').insertOne(listing)
        return json({ listing: clean(listing) })
      }
      if (route.startsWith('/admin/listings/') && method === 'PUT') {
        const b = await request.json()
        const upd = {}
        if (b.stock != null && b.stock !== '') { const s = Math.max(0, parseInt(b.stock)); upd.stock = s; upd.status = s > 0 ? 'active' : 'sold' }
        if (b.price != null && b.price !== '') { const p = parseFloat(b.price); if (p > 0) upd.price = p }
        if (b.condition) upd.condition = b.condition
        if (Object.keys(upd).length === 0) return json({ error: 'Nothing to update' }, 400)
        await db.collection('listings').updateOne({ id: path[2] }, { $set: upd })
        const l = await db.collection('listings').findOne({ id: path[2] })
        return json({ listing: clean(l) })
      }
      if (route.startsWith('/admin/listings/') && method === 'DELETE') { await db.collection('listings').updateOne({ id: path[2] }, { $set: { status: 'removed' } }); return json({ success: true }) }

      if (route === '/admin/orders' && method === 'GET') return json({ orders: (await db.collection('orders').find({}).sort({ createdAt: -1 }).toArray()).map(clean) })
      if (route === '/admin/reports' && method === 'GET') return json({ reports: (await db.collection('reports').find({}).sort({ createdAt: -1 }).toArray()).map(clean) })
      if (route.startsWith('/admin/reports/') && method === 'POST') { await db.collection('reports').updateOne({ id: path[2] }, { $set: { status: 'resolved' } }); return json({ success: true }) }

      // ----- Support chat inbox -----
      if (route === '/admin/chat/threads' && method === 'GET') {
        const threads = await db.collection('chatThreads').find({}).sort({ lastMessageAt: -1 }).toArray()
        const withPreview = await Promise.all(threads.map(async t => {
          const last = await db.collection('chatMessages').find({ threadId: t.id }).sort({ createdAt: -1 }).limit(1).toArray()
          return { ...clean(t), lastMessage: last[0]?.text || '' }
        }))
        return json({ threads: withPreview })
      }
      if (route.startsWith('/admin/chat/threads/') && route.endsWith('/messages') && method === 'GET') {
        const threadId = path[3]
        await db.collection('chatThreads').updateOne({ id: threadId }, { $set: { unreadForAdmin: false } })
        const messages = await db.collection('chatMessages').find({ threadId }).sort({ createdAt: 1 }).toArray()
        return json({ messages: messages.map(clean) })
      }
      if (route.startsWith('/admin/chat/threads/') && route.endsWith('/reply') && method === 'POST') {
        const threadId = path[3]
        const b = await request.json().catch(() => ({}))
        const text = String(b.text || '').trim().slice(0, 2000)
        if (!text) return json({ error: 'Empty message' }, 400)
        const msg = { id: uuidv4(), threadId, sender: 'staff', text, createdAt: new Date() }
        await db.collection('chatMessages').insertOne(msg)
        await db.collection('chatThreads').updateOne({ id: threadId }, { $set: { unreadForUser: true, lastMessageAt: new Date(), status: 'open' } })
        return json({ message: clean(msg) })
      }
      if (route.startsWith('/admin/chat/threads/') && route.endsWith('/close') && method === 'POST') {
        await db.collection('chatThreads').updateOne({ id: path[3] }, { $set: { status: 'closed' } })
        return json({ success: true })
      }
    }

    return json({ error: `Route ${route} not found` }, 404)
  } catch (error) {
    // A database outage is not an application bug: answer 503 with a distinct flag so the
    // UI can say "can't reach the database" instead of a misleading "internal error", and
    // drop the dead client so the next request retries instead of failing forever.
    if (error instanceof DbUnavailableError || isConnectivityError(error)) {
      resetMongoOnConnectivityError(error)
      console.error('DB unavailable:', error.cause ? String(error.cause.message).split('\n')[0] : error.message)
      return handleCORS(NextResponse.json(
        { error: 'Cannot reach the database right now. Please try again in a moment.', dbUnavailable: true },
        { status: 503, headers: { 'Retry-After': '10' } }
      ))
    }
    // Full detail stays server-side only — an unhandled error can carry internal state
    // (stack traces, query fragments, etc.) that should never reach a client.
    console.error('API Error:', error)
    return json({ error: 'Internal server error' }, 500)
  }
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
