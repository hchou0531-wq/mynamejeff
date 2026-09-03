// Renders a dashboard image from real Ethereal data.
//
// Why render rather than screenshot the live page: the Discord dashboard sits behind
// admin login *and* a TOTP second factor, so driving a headless browser would mean
// automating a 2FA bypass — fragile, and it would weaken the protection we added on
// purpose. Composing the image from the same API the dashboard itself calls gives the
// identical numbers with no browser, no login, and no secret handling.
import { getEarnings, getMonthlySeries } from './earnings.js'
import { listOrders, listPendingFulfillment, statusLabel } from './orders.js'
import { client } from './client.js'

const C = {
  bg: '#140a24',
  panel: '#1c1030',
  panel2: '#2d1454',
  gold: '#a855f7',
  goldDim: '#6b21a8',
  green: '#c084fc',
  coral: '#f472b6',
  ink: '#f3e8ff',
  muted: '#a394c7',
}

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const money = n => `$${(Number(n) || 0).toFixed(2)}`
const SANS = 'Helvetica, Arial, DejaVu Sans, sans-serif'
const MONO = 'Menlo, DejaVu Sans Mono, monospace'

function frame(width, height, title, subtitle, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.panel2}"/><stop offset="60%" stop-color="${C.bg}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.gold}"/><stop offset="100%" stop-color="${C.coral}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="18" y="18" width="${width - 36}" height="${height - 36}" fill="none" stroke="${C.goldDim}" stroke-width="2"/>
  <text x="44" y="66" font-family="${SANS}" font-size="26" font-weight="bold" fill="${C.ink}" letter-spacing="3">${esc(title)}</text>
  <text x="44" y="90" font-family="${MONO}" font-size="12" fill="${C.muted}" letter-spacing="2">${esc(subtitle)}</text>
  <line x1="44" y1="104" x2="${width - 44}" y2="104" stroke="${C.goldDim}" stroke-width="1"/>
  ${inner}
  <text x="44" y="${height - 30}" font-family="${MONO}" font-size="11" fill="${C.muted}">ETHEREAL · generated ${esc(new Date().toLocaleString())}</text>
</svg>`
}

function statCard(x, y, w, h, label, value, color) {
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.panel}" stroke="${C.goldDim}" stroke-width="1"/>
    <text x="${x + 16}" y="${y + 26}" font-family="${MONO}" font-size="11" fill="${C.muted}" letter-spacing="1.5">${esc(label)}</text>
    <text x="${x + 16}" y="${y + 60}" font-family="${SANS}" font-size="28" font-weight="bold" fill="${color}">${esc(value)}</text>
  </g>`
}

function barChart(x, y, w, h, series) {
  if (!series.length) {
    return `<text x="${x}" y="${y + 40}" font-family="${SANS}" font-size="14" fill="${C.muted}">No revenue recorded in this range yet.</text>`
  }
  const max = Math.max(...series.map(s => s.revenue), 1)
  const slot = w / series.length
  const barW = Math.min(52, slot * 0.55)
  let out = `<line x1="${x}" y1="${y + h}" x2="${x + w}" y2="${y + h}" stroke="${C.goldDim}" stroke-width="1"/>`
  series.forEach((s, i) => {
    const bh = Math.max(2, Math.round((s.revenue / max) * (h - 26)))
    const bx = Math.round(x + slot * i + (slot - barW) / 2)
    const by = y + h - bh
    out += `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" fill="url(#accent)"/>`
    out += `<text x="${bx + barW / 2}" y="${by - 7}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${C.ink}">${esc(money(s.revenue))}</text>`
    out += `<text x="${bx + barW / 2}" y="${y + h + 18}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${C.muted}">${esc(s.month)}</text>`
  })
  return out
}

function rows(x, y, items, emptyText) {
  if (!items.length) {
    return `<text x="${x}" y="${y + 24}" font-family="${SANS}" font-size="14" fill="${C.muted}">${esc(emptyText)}</text>`
  }
  return items.map((it, i) => {
    const ry = y + i * 46
    return `<g>
      <rect x="${x}" y="${ry}" width="812" height="38" fill="${C.panel}" stroke="${C.goldDim}" stroke-width="1"/>
      <text x="${x + 14}" y="${ry + 24}" font-family="${MONO}" font-size="13" fill="${C.gold}">#${esc(it.left)}</text>
      <text x="${x + 96}" y="${ry + 24}" font-family="${SANS}" font-size="13" fill="${C.ink}">${esc(it.mid)}</text>
      <text x="${x + 520}" y="${ry + 24}" font-family="${MONO}" font-size="13" fill="${C.green}">${esc(it.money)}</text>
      <text x="${x + 620}" y="${ry + 24}" font-family="${SANS}" font-size="12" fill="${C.muted}">${esc(it.right)}</text>
    </g>`
  }).join('')
}

async function toPng(svg) {
  // sharp ships with Next.js; imported lazily so the rest of the agent runs without it.
  const sharp = (await import('sharp')).default
  return sharp(Buffer.from(svg)).png().toBuffer()
}

export async function renderDashboard(section = 'overview', { deps = { client } } = {}) {
  const sec = String(section || 'overview').toLowerCase()

  if (sec === 'orders') {
    const list = await listOrders({ limit: 8, filter: 'recent', deps })
    const items = list.map(o => ({
      left: o.txNumber ?? o.orderCode,
      mid: o.item?.name || o.type || 'Order',
      money: money(o.amountUsd),
      right: statusLabel(o),
    }))
    const svg = frame(900, 200 + Math.max(1, items.length) * 46, 'RECENT ORDERS', `${items.length} shown`, rows(44, 130, items, 'No orders yet.'))
    return { png: await toPng(svg), caption: '📊 Ethereal Dashboard — Recent Orders' }
  }

  if (sec === 'analytics') {
    const [earn, monthly] = await Promise.all([
      getEarnings({ deps }),
      getMonthlySeries({ range: '6m', deps }).catch(() => ({ series: [] })),
    ])
    const inner = `
      ${statCard(44, 130, 250, 86, 'ALL-TIME REVENUE', money(earn.revenue.allTime), C.gold)}
      ${statCard(318, 130, 250, 86, 'AVG ORDER VALUE', money(earn.averageOrderValue), C.green)}
      ${statCard(592, 130, 264, 86, 'PAID ORDERS', String(earn.counts.paidAllTime), C.coral)}
      <text x="44" y="256" font-family="${MONO}" font-size="12" fill="${C.muted}" letter-spacing="2">REVENUE BY MONTH</text>
      ${barChart(44, 274, 812, 150, monthly.series || [])}`
    const svg = frame(900, 500, 'ANALYTICS', 'last 6 months', inner)
    return { png: await toPng(svg), caption: '📊 Ethereal Dashboard — Analytics' }
  }

  if (sec === 'earnings') {
    const earn = await getEarnings({ deps })
    const inner = `
      ${statCard(44, 130, 250, 86, 'TODAY', money(earn.revenue.today), C.gold)}
      ${statCard(318, 130, 250, 86, 'THIS WEEK', money(earn.revenue.week), C.green)}
      ${statCard(592, 130, 264, 86, 'THIS MONTH', money(earn.revenue.month), C.coral)}
      ${statCard(44, 236, 250, 86, 'ORDERS TODAY', String(earn.counts.today), C.ink)}
      ${statCard(318, 236, 250, 86, 'AVG ORDER', money(earn.averageOrderValue), C.ink)}
      ${statCard(592, 236, 264, 86, 'AWAITING FULFILL', String(earn.counts.awaitingFulfillment), earn.counts.awaitingFulfillment ? C.coral : C.ink)}`
    const svg = frame(900, 380, 'EARNINGS', 'live from Ethereal', inner)
    return { png: await toPng(svg), caption: '📊 Ethereal Dashboard — Earnings' }
  }

  // default: overview
  const [earn, pending] = await Promise.all([
    getEarnings({ deps }),
    listPendingFulfillment({ deps }).catch(() => []),
  ])
  const pendingItems = pending.slice(0, 4).map(p => ({
    left: p.orderCode,
    mid: p.title || 'Toy Code',
    money: '',
    right: 'Awaiting fulfillment',
  }))
  const inner = `
    ${statCard(44, 130, 250, 86, 'TODAY', money(earn.revenue.today), C.gold)}
    ${statCard(318, 130, 250, 86, 'THIS WEEK', money(earn.revenue.week), C.green)}
    ${statCard(592, 130, 264, 86, 'THIS MONTH', money(earn.revenue.month), C.coral)}
    <text x="44" y="264" font-family="${MONO}" font-size="12" fill="${C.muted}" letter-spacing="2">AWAITING FULFILLMENT (${pending.length})</text>
    ${rows(44, 280, pendingItems, 'Nothing awaiting fulfillment — you are all caught up.')}`
  const height = 340 + Math.max(1, pendingItems.length) * 46
  const svg = frame(900, height, 'ETHEREAL DASHBOARD', 'overview', inner)
  return { png: await toPng(svg), caption: '📊 Ethereal Dashboard — Overview' }
}
