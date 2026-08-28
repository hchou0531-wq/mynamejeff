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

// ---------------- CoinGate ----------------
function coingateBase() {
  return process.env.COINGATE_ENV === 'live' ? 'https://api.coingate.com/api/v2' : 'https://api-sandbox.coingate.com/api/v2'
}
function coingateConfigured() { return !!(process.env.COINGATE_API_TOKEN && process.env.COINGATE_API_TOKEN.trim()) }

async function coingateCreateOrder(order, listing) {
  const base = process.env.NEXT_PUBLIC_BASE_URL
  const payload = {
    order_id: order.orderId,
    price_amount: Number(listing.price).toFixed(2),
    price_currency: 'USD',
    receive_currency: process.env.COINGATE_RECEIVE_CURRENCY || 'USDT',
    title: listing.item.name,
    description: `Purchase of ${listing.item.name} on Robloot`,
    callback_url: `${base}/api/payments/callback`,
    cancel_url: `${base}/?payment=cancel&orderId=${order.orderId}`,
    success_url: `${base}/?payment=success&orderId=${order.orderId}`
  }
  const res = await fetch(`${coingateBase()}/orders`, {
    method: 'POST',
    headers: { Authorization: `Token ${process.env.COINGATE_API_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.reason || `CoinGate HTTP ${res.status}`)
  return data // { id, status, payment_url, token, order_id, ... }
}

async function coingateGetOrder(coingateId) {
  const res = await fetch(`${coingateBase()}/orders/${coingateId}`, {
    headers: { Authorization: `Token ${process.env.COINGATE_API_TOKEN}`, Accept: 'application/json' }
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `CoinGate HTTP ${res.status}`)
  return data
}

// ---------------- Roblox lookup ----------------
function parseRobloxAssetId(value) {
  if (!value) return null
  const s = String(value).trim()
  if (/^\d+$/.test(s)) { const n = Number(s); return n > 0 ? n : null }
  try {
    const url = new URL(s)
    if (!/roblox\.com$/.test(url.hostname.replace('www.', ''))) return null
    const m = url.pathname.match(/\/(?:catalog|library|item)\/(\d+)/)
    if (m) return Number(m[1])
    const id = url.searchParams.get('id') || url.searchParams.get('Id')
    if (id && /^\d+$/.test(id)) return Number(id)
    return null
  } catch { return null }
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
  const catalog = await robloxGetJson('https://catalog.roblox.com/v1/catalog/items/details', {
    method: 'POST', body: JSON.stringify({ items: [{ itemType: 'Asset', id: assetId }] })
  })
  const item = (catalog && catalog.data && catalog.data[0]) || null
  if (!item) throw new Error('Item not found on Roblox')
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
  const collectibleItemId = item.collectibleItemId || null
  if (collectibleItemId) {
    try { const m = await robloxGetJson(`https://apis.roblox.com/marketplace-sales/v1/item/${encodeURIComponent(collectibleItemId)}/resale-data`); rap = m.recentAveragePrice ?? null } catch (e) {}
  }
  if (rap == null) {
    try { const l = await robloxGetJson(`https://economy.roblox.com/v1/assets/${assetId}/resale-data`); rap = l.recentAveragePrice ?? null } catch (e) {}
  }
  return {
    assetId,
    name: item.name || `Roblox Item ${assetId}`,
    description: item.description || '',
    imageUrl,
    lowestResalePrice: item.lowestResalePrice ?? item.lowestPrice ?? item.price ?? null,
    rap,
    collectibleItemId
  }
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
    if (route === '/config' && method === 'GET') return json({ cryptoConfigured: coingateConfigured(), receiveCurrency: process.env.COINGATE_RECEIVE_CURRENCY || 'USDT' })

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

      const order = {
        id: uuidv4(), orderId: `ord_${uuidv4()}`, listingId: listing.id, item: listing.item,
        buyerId: user.id, buyerName: user.username, sellerName: listing.sellerName,
        amountUsd: listing.price, currency: process.env.COINGATE_RECEIVE_CURRENCY || 'USDT',
        provider: 'coingate', status: 'pending_payment', checkoutUrl: null,
        coingateId: null, coingateToken: null, createdAt: new Date(), paidAt: null
      }
      await db.collection('orders').insertOne(order)
      if (!coingateConfigured()) {
        // Demo mode: no live token yet. Return order so client can complete a simulated payment.
        return json({ orderId: order.orderId, checkoutUrl: null, simulated: true })
      }
      try {
        const cg = await coingateCreateOrder(order, listing)
        await db.collection('orders').updateOne({ orderId: order.orderId }, { $set: { coingateId: String(cg.id), coingateToken: cg.token || null, checkoutUrl: cg.payment_url } })
        return json({ orderId: order.orderId, checkoutUrl: cg.payment_url })
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

    // ---------- PAYMENTS ----------
    if (route === '/payments/status' && method === 'GET') {
      const orderId = q.get('orderId')
      if (!orderId) return json({ error: 'orderId required' }, 400)
      const order = await db.collection('orders').findOne({ orderId })
      if (!order) return json({ error: 'Not found' }, 404)
      return json({ orderId, status: order.status, item: order.item, amountUsd: order.amountUsd })
    }

    if (route === '/payments/callback' && method === 'POST') {
      let body = {}
      const ct = request.headers.get('content-type') || ''
      try {
        if (ct.includes('application/json')) body = await request.json()
        else { const fd = await request.formData(); fd.forEach((v, k) => { body[k] = v }) }
      } catch (e) { body = {} }
      const orderId = body.order_id
      if (!orderId) return json({ ok: true })
      const order = await db.collection('orders').findOne({ orderId })
      if (!order) return json({ ok: true })
      // verify token echoed back matches the one CoinGate gave us
      if (order.coingateToken && body.token && String(body.token) !== String(order.coingateToken)) {
        return json({ error: 'Invalid token' }, 401)
      }
      // confirm real status from CoinGate API
      let status = body.status
      try { if (order.coingateId) { const remote = await coingateGetOrder(order.coingateId); status = remote.status } } catch (e) {}
      const s = String(status || '').toLowerCase()
      const paid = s === 'paid'
      const dead = ['invalid', 'expired', 'canceled', 'refunded'].includes(s)
      if (paid && order.status !== 'paid') {
        await db.collection('orders').updateOne({ orderId, status: { $ne: 'paid' } }, { $set: { status: 'paid', paidAt: new Date() } })
        await fulfillListing(db, order.listingId)
        await notify(db, order.buyerId, `Payment confirmed! You now own ${order.item.name}.`, 'success')
      } else if (dead && order.status !== 'paid') {
        await db.collection('orders').updateOne({ orderId }, { $set: { status: s } })
      }
      return json({ ok: true })
    }

    // dev/testing helper: mark an order paid without live provider (only when crypto NOT configured)
    if (route === '/payments/simulate' && method === 'POST') {
      if (coingateConfigured()) return json({ error: 'Disabled while live crypto is configured' }, 403)
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
