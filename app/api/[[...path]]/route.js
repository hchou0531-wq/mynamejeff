import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'

// ---------------- MongoDB ----------------
let clientPromise
async function connectToMongo() {
  if (!clientPromise) {
    clientPromise = new MongoClient(process.env.MONGO_URL).connect()
  }
  const c = await clientPromise
  return c.db(process.env.DB_NAME)
}

const ROBUX_RATE = 80 // R$ per USD (display only)

function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}
export async function OPTIONS() { return handleCORS(new NextResponse(null, { status: 200 })) }
function json(data, status = 200) { return handleCORS(NextResponse.json(data, { status })) }
function clean(doc) { if (!doc) return doc; const { _id, password, ...rest } = doc; return rest }
function publicUser(u) { if (!u) return null; const { _id, password, email, ...rest } = u; return rest }

async function getUser(request, db) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.replace('Bearer ', '').trim()
  if (!token) return null
  return await db.collection('users').findOne({ id: token })
}
async function notify(db, userId, text, type = 'info') {
  await db.collection('notifications').insertOne({ id: uuidv4(), userId, text, type, read: false, createdAt: new Date() })
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
        await fulfillListing(db, order.listingId)
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
async function robloxCheckoutEligibility(userId) {
  const out = {
    userId: Number(userId),
    premium: null, premiumChecked: false,
    inventoryPublic: null, inventoryChecked: false,
    tradesEnabled: null, tradeStatus: null, tradesChecked: false, // trades privacy is not verifiable by third parties -> UI always shows guidance
    limiteds: [], rapLimit: RAP_LIMIT
  }
  // Inventory visibility (public endpoint, no auth needed)
  try { const iv = await robloxGetJson(`https://inventory.roblox.com/v1/users/${userId}/can-view-inventory`); out.inventoryPublic = !!iv.canView; out.inventoryChecked = true } catch (e) {}
  // Premium via Roblox Open Cloud
  const p = await robloxPremium(userId)
  out.premium = p.premium; out.premiumChecked = p.checked
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
const REGULAR_TYPES = [[8, 'Hats'], [41, 'Hair'], [42, 'Face Accessories'], [43, 'Neck'], [44, 'Shoulder'], [45, 'Front'], [46, 'Back'], [47, 'Waist'], [18, 'Faces'], [19, 'Gear'], [11, 'Shirts'], [12, 'Pants']]
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
      id: uuidv4(), username: 'Admin', email: adminEmail, password: process.env.ADMIN_PASSWORD || 'admin123',
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
    await doSeed(db)

    if (route === '/' || route === '/root') return json({ message: 'Robloot Marketplace API' })
    if (route === '/seed' && method === 'POST') return json(await doSeed(db, true))
    if (route === '/config' && method === 'GET') return json({ cryptoConfigured: blockbeeConfigured(), provider: 'blockbee', receiveCurrency: process.env.BLOCKBEE_RECEIVE_CURRENCY || 'USDT' })

    // ---------- REVIEWS (public) ----------
    if (route === '/reviews' && method === 'GET') {
      const settings = await db.collection('settings').findOne({ id: 'reviews' })
      const reviews = await db.collection('reviews').find({}).sort({ pinned: -1, createdAt: -1 }).toArray()
      return json({ totalSales: settings?.totalSales ?? 0, reviews: reviews.map(clean) })
    }

    // ---------- ROBLOX PROFILES (public) ----------
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
    if (route === '/auth/signup' && method === 'POST') {
      const b = await request.json()
      if (!b.username || !b.email || !b.password) return json({ error: 'Missing fields' }, 400)
      const exists = await db.collection('users').findOne({ $or: [{ email: b.email }, { username: b.username }] })
      if (exists) return json({ error: 'Username or email already taken' }, 400)
      const user = {
        id: uuidv4(), username: b.username, email: b.email, password: b.password,
        avatarUrl: `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(b.username)}`,
        reputation: 5, isAdmin: false, demo: false, createdAt: new Date()
      }
      await db.collection('users').insertOne(user)
      await notify(db, user.id, 'Welcome to Robloot! Browse the marketplace and pay securely with crypto.', 'success')
      return json({ token: user.id, user: clean(user) })
    }
    if (route === '/auth/login' && method === 'POST') {
      const b = await request.json()
      const user = await db.collection('users').findOne({ email: b.email, password: b.password })
      if (!user) return json({ error: 'Invalid credentials' }, 401)
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

    // ---------- ADMIN ----------
    if (route.startsWith('/admin/')) {
      const user = await getUser(request, db)
      if (!user || !user.isAdmin) return json({ error: 'Admin only' }, 403)

      // ----- Reviews management -----
      if (route === '/admin/reviews/settings' && method === 'POST') {
        const b = await request.json()
        const totalSales = Math.max(0, Math.floor(Number(b.totalSales) || 0))
        await db.collection('settings').updateOne({ id: 'reviews' }, { $set: { id: 'reviews', totalSales, updatedAt: new Date() } }, { upsert: true })
        return json({ success: true, totalSales })
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
        // Optionally set total sales to the detected eBay feedback score if admin hasn't set one yet
        if (parsed.feedbackScore != null && b.setTotalSales) {
          await db.collection('settings').updateOne({ id: 'reviews' }, { $set: { id: 'reviews', totalSales: parsed.feedbackScore, updatedAt: new Date() } }, { upsert: true })
        }
        return json({ imported, skipped, detected: parsed.items.length, feedbackScore: parsed.feedbackScore, handle: parsed.handle })
      }

      if (route === '/admin/roblox-lookup' && method === 'POST') {
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
    }

    return json({ error: `Route ${route} not found` }, 404)
  } catch (error) {
    console.error('API Error:', error)
    return json({ error: 'Internal server error', detail: String(error) }, 500)
  }
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
