'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetTitle, SheetClose } from '@/components/ui/sheet'
import {
  Search, ShoppingCart, Store, Star, Sparkles, Heart, Bell, Plus, LayoutGrid,
  Shield, TrendingUp, Clock, Tag, ChevronLeft, LogOut, User, CheckCircle2, Flag, Loader2, Gem, Package, Zap, Bitcoin, Trash2, Gamepad2, Info, BadgeCheck, Calendar, Coins,
  AlertTriangle, ExternalLink, Crown, ShieldCheck, Lock, ThumbsUp, ThumbsDown, MessageSquare, Upload, Quote, Ticket, X, Send, RefreshCw, Menu
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer } from 'recharts'

const ROBUX_RATE = 80
const DISCORD_INVITE = 'https://discord.gg/ethereals'
const CATEGORIES = ['All', 'Limiteds', 'Accessories', 'UGC', 'Collectibles', 'Gear', 'Faces', 'Bundles']
// Shared by the desktop nav and the mobile drawer so the two can't drift out of sync.
const NAV_ITEMS = [['browse', 'Shop'], ['toycodes', 'Toy Codes'], ['profiles-store', 'Profiles'], ['reviews', 'Reviews']]
const CAT_ICONS = { Limiteds: Gem, Accessories: Sparkles, UGC: Package, Collectibles: Star, Gear: Zap, Faces: User, Bundles: LayoutGrid }
const CONDITIONS = ['All', 'Mint', 'Rare', 'New', 'Used']
const rbx = (u) => Math.round(u * ROBUX_RATE).toLocaleString()
const usd = (n) => `$${Number(n).toFixed(2)}`
async function copyText(t, label = 'Copied') {
  try { await navigator.clipboard.writeText(t); toast.success(label) }
  catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.focus(); ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      toast[ok ? 'success' : 'error'](ok ? label : 'Could not copy — select and copy it manually')
    } catch { toast.error('Could not copy — select and copy it manually') }
  }
}

function useApi() {
  return useCallback(async (path, opts = {}) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('rbx_token') : null
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 45000)
    let res
    try {
      res = await fetch(`/api${path}`, {
        ...opts, signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) }
      })
    } catch (e) {
      clearTimeout(to)
      throw new Error(e.name === 'AbortError' ? 'Request timed out — please try again' : 'Network error — check your connection')
    }
    clearTimeout(to)
    const ct = res.headers.get('content-type') || ''
    let data = {}
    if (ct.includes('application/json')) data = await res.json().catch(() => ({}))
    else { const t = await res.text().catch(() => ''); if (t && res.ok) return t; data = {} }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (HTTP ${res.status})`)
      err.status = res.status
      // Surfaced by the API when the database itself is unreachable, so callers can show a
      // "service is down, retrying" state rather than treating it as a normal failure.
      err.dbUnavailable = !!data.dbUnavailable
      throw err
    }
    return data
  }, [])
}

function PriceTag({ price, size = 'md' }) {
  return (
    <div className="flex flex-col">
      <span className={`font-vt text-[#a855f7] ${size === 'lg' ? 'text-3xl' : 'text-xl'}`}>{usd(price)}</span>
      <span className="text-[11px] text-[#a394c7] font-semibold">{rbx(price)} R$</span>
    </div>
  )
}

function rarityFor(listing) {
  const p = Number(listing?.price) || 0
  if (p >= 500) return { key: 'legendary', color: 'var(--eth-legendary)', label: 'LEGENDARY' }
  if (p >= 150) return { key: 'epic', color: 'var(--eth-epic)', label: 'EPIC' }
  if (p >= 50) return { key: 'rare', color: 'var(--eth-rare)', label: 'RARE' }
  return { key: 'common', color: 'var(--eth-common)', label: 'COMMON' }
}

function ItemCard({ listing, onOpen }) {
  const sold = listing.status && listing.status !== 'active'
  const rarity = rarityFor(listing)
  return (
    <Card onClick={() => onOpen(listing)} className="group relative overflow-hidden rounded-none border-2 transition-all cursor-pointer hover:-translate-y-1"
      style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.5), rgba(20,10,36,0.85))', borderColor: rarity.color }}>
      <div className="relative aspect-square overflow-hidden" style={{ background: `radial-gradient(circle, ${rarity.color}22, transparent 70%)` }}>
        <img src={listing.item.imageUrl} alt={listing.item.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
        <Badge className="absolute top-2 left-2 bg-black/70 backdrop-blur text-[#c084fc] border-[#c084fc]/40">{listing.item.category}</Badge>
        <Badge className="absolute top-2 right-2 bg-emerald-500/20 text-emerald-300 border-emerald-500/40">{listing.condition}</Badge>
        {sold && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><Badge className="bg-red-500/90 text-white">SOLD</Badge></div>}
      </div>
      <div className="p-3 space-y-2">
        <h3 className="font-vt text-base truncate" style={{ color: 'var(--eth-ink)' }}>{listing.item.name}</h3>
        <p className="font-pixel text-[7px] tracking-widest" style={{ color: rarity.color }}>{rarity.label}</p>
        <div className="flex items-center justify-between">
          <PriceTag price={listing.price} />
          <div className="flex items-center gap-1 text-xs text-slate-400"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{(listing.sellerRep || 5).toFixed(1)}</div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400 truncate"><img src={listing.sellerAvatar} className="w-4 h-4 rounded-full bg-white/10" alt="" />{listing.sellerName}</div>
      </div>
    </Card>
  )
}

// `compactOnMobile`: below ~400px the header row is hamburger + logo + Login/Sign Up all
// competing for one line — measured, the full "ETHEREAL" wordmark was the single biggest
// fixed cost in it and pushed Sign Up off the edge. Icon-only there is enough to close the
// gap without touching the buttons. Only the main header opts in — the footer and the
// mobile drawer's own header each have the full row to themselves, so the wordmark stays.
// Icon dropped here — it's reserved for the boot screen now, so this is wordmark-only.
// `compactOnMobile` (the main header, where space is tightest) sizes it down on very small
// screens rather than hiding it outright, since with no icon there's nothing to fall back to.
function Logo({ onClick, compactOnMobile }) {
  return (
    <button onClick={onClick} className="flex items-center">
      <img src="/wordmark.png" alt="Ethereal" className={compactOnMobile ? 'h-6 sm:h-9 w-auto' : 'h-9 w-auto'} />
    </button>
  )
}

const BOOT_STARS = [
  { top: '10%', left: '12%', delay: .2 }, { top: '18%', left: '82%', delay: .9 },
  { top: '7%', left: '48%', delay: 1.4 }, { top: '28%', left: '68%', delay: .6 },
  { top: '14%', left: '22%', delay: 1.8 }, { top: '33%', left: '90%', delay: 2.2 },
  { top: '40%', left: '8%', delay: 1.1 }, { top: '45%', left: '55%', delay: .4 },
]
const BOOT_ORBS = [
  { top: '15%', left: '15%', size: 10, color: 'var(--eth-teal)', delay: 0 },
  { top: '24%', left: '78%', size: 14, color: 'var(--eth-lavender)', delay: 2 },
  { top: '38%', left: '40%', size: 8, color: 'var(--eth-gold)', delay: 1 },
]

// Replaces the desktop <nav> below md: it's `hidden` there with nothing standing in for
// it, so the four primary sections (and Admin) were completely unreachable on any phone.
function MobileNavSheet({ open, setOpen, go, user }) {
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="w-[78vw] max-w-xs border-r p-0 flex flex-col" style={{ background: 'rgba(20,10,36,0.98)', borderColor: 'var(--eth-gold-dim)' }}>
        <SheetTitle className="sr-only">Navigation menu</SheetTitle>
        <div className="h-16 flex items-center px-4 border-b shrink-0" style={{ borderColor: 'rgba(107,33,168,0.25)' }}>
          <Logo onClick={() => go('browse')} />
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {NAV_ITEMS.map(([name, label]) => (
            <button
              key={name}
              onClick={() => go(name)}
              className="w-full text-left font-pixel text-[11px] tracking-wider px-5 py-4 border-l-2 border-transparent transition-colors active:text-[var(--eth-ink)] active:border-l-[var(--eth-gold)] active:bg-white/5"
              style={{ color: 'var(--eth-muted)' }}
            >
              {label.toUpperCase()}
            </button>
          ))}
          {user?.isAdmin && (
            <button onClick={() => go('admin')} className="w-full text-left font-pixel text-[11px] tracking-wider px-5 py-4 border-l-2 border-transparent" style={{ color: 'var(--eth-gold)' }}>
              ADMIN
            </button>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  )
}

function BootScreen({ progress, leaving, onSkip }) {
  return (
    <div
      onClick={onSkip}
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden cursor-pointer transition-opacity duration-500 ${leaving ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      style={{ background: 'radial-gradient(ellipse 1000px 700px at 50% 30%, var(--eth-night3) 0%, var(--eth-night2) 45%, var(--eth-night1) 100%)' }}
    >
      <div className="absolute inset-0">
        {BOOT_STARS.map((s, i) => (
          <div key={i} className="absolute w-[2px] h-[2px] rounded-full" style={{ top: s.top, left: s.left, background: 'var(--eth-teal)', boxShadow: '0 0 6px var(--eth-teal)', animation: `eth-tw 3s ease-in-out ${s.delay}s infinite` }} />
        ))}
        {BOOT_ORBS.map((o, i) => (
          <div key={i} className="absolute rounded-full blur-[2px] opacity-50" style={{ top: o.top, left: o.left, width: o.size, height: o.size, background: o.color, boxShadow: `0 0 20px ${o.color}`, animation: `eth-drift 7s ease-in-out ${o.delay}s infinite` }} />
        ))}
      </div>
      <div className="relative text-center px-6">
        <div className="hidden md:block absolute -inset-16 border-2 pointer-events-none" style={{ borderColor: 'var(--eth-gold-dim)' }} />
        <img src="/logo.png" alt="" className="h-20 md:h-24 w-auto mx-auto mb-4" />
        <img
          src="/wordmark.png"
          alt="Ethereal"
          className="h-14 md:h-20 w-auto mx-auto"
          style={{ filter: 'drop-shadow(0 0 18px rgba(192,132,252,0.6)) drop-shadow(0 0 40px rgba(244,114,182,0.4))' }}
        />
        <p className="font-vt text-2xl tracking-[0.3em] mt-3" style={{ color: 'var(--eth-gold)' }}>A REALM OF RARE FINDS</p>
        <div className="mt-12 w-full max-w-[320px] md:max-w-[420px] mx-auto">
          <div className="flex justify-between font-pixel text-[9px] tracking-widest mb-2" style={{ color: 'var(--eth-muted)' }}>
            <span>ENTERING THE VAULT</span><span>{Math.round(progress)}%</span>
          </div>
          <div className="h-5 border-2 relative overflow-hidden" style={{ borderColor: 'var(--eth-gold)', background: 'rgba(20,10,36,0.8)', boxShadow: '0 0 14px rgba(168,85,247,0.35), inset 0 0 8px rgba(0,0,0,0.6)' }}>
            <div className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, var(--eth-teal), var(--eth-lavender))', boxShadow: '0 0 16px var(--eth-teal)' }} />
          </div>
        </div>
        <p className="font-vt text-base italic mt-4" style={{ color: 'var(--eth-muted)' }}>&ldquo;The ethereal winds carry treasures from realms unknown...&rdquo;</p>
        <p className="font-pixel text-[11px] tracking-widest mt-8" style={{ color: 'var(--eth-teal)', animation: 'eth-blink 1.2s steps(1) infinite' }}>
          {progress >= 100 ? 'PRESS START' : 'LOADING'}
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const api = useApi()
  const [user, setUser] = useState(null)
  const [view, setView] = useState({ name: 'browse' })
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [booting, setBooting] = useState(true)
  const [cfg, setCfg] = useState({ cryptoConfigured: true })
  const [bootProgress, setBootProgress] = useState(8)
  const [bootLeaving, setBootLeaving] = useState(false)
  const [showBoot, setShowBoot] = useState(true)
  const [legalOpen, setLegalOpen] = useState(null) // 'privacy' | 'tos' | 'disclaimer' | null
  const [dbDown, setDbDown] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const go = (name, params = {}) => { setView({ name, ...params }); window.scrollTo(0, 0); setMobileNavOpen(false) }
  const loadMe = useCallback(async () => {
    try { const d = await api('/me'); setDbDown(false); setUser(d.user); return d.user }
    catch (e) {
      // Only a real rejection (401/403) means the token is bad. A database outage or network
      // blip must NOT wipe the session — that was silently signing people out mid-outage.
      if (e.dbUnavailable || e.status == null || e.status >= 500) { setDbDown(!!e.dbUnavailable); return null }
      localStorage.removeItem('rbx_token'); setUser(null); return null
    }
  }, [api])
  const loadNotifs = useCallback(async () => { try { const d = await api('/notifications'); setNotifications(d.notifications || []) } catch {} }, [api])

  const exitBoot = useCallback(() => {
    setBootLeaving(true)
    setTimeout(() => setShowBoot(false), 550)
  }, [])

  useEffect(() => {
    const start = Date.now()
    const MIN_MS = 1700
    ;(async () => {
      setBootProgress(20)
      api('/config').then((c) => { setCfg(c); setDbDown(false) }).catch((e) => { if (e.dbUnavailable) setDbDown(true) })
      setBootProgress(45)
      const t = localStorage.getItem('rbx_token')
      if (t) { const u = await loadMe(); setBootProgress(75); if (u) await loadNotifs() }
      setBootProgress(100)
      setBooting(false)
      setTimeout(exitBoot, Math.max(0, MIN_MS - (Date.now() - start)))
      // handle crypto redirect return
      const params = new URLSearchParams(window.location.search)
      const orderId = params.get('orderId')
      const pay = params.get('payment')
      if (orderId && pay) {
        window.history.replaceState({}, '', window.location.pathname)
        setView({ name: 'order', orderId })
      }
    })()
  }, [loadMe, loadNotifs, api, exitBoot])

  const requireAuth = (fn) => { if (!user) { setAuthMode('login'); setAuthOpen(true); toast.info('Please sign in to continue'); return } fn() }
  // Revoke the session server-side too — clearing localStorage alone left the token valid
  // forever for anyone who had captured it. Fire-and-forget: the local sign-out must happen
  // even if the request fails.
  const logout = () => {
    api('/auth/logout', { method: 'POST' }).catch(() => {})
    localStorage.removeItem('rbx_token'); setUser(null); go('home'); toast.success('Signed out')
  }
  const unread = notifications.filter(n => !n.read).length

  // flex flex-col + flex-1 on <main>: without this, a short page (an empty marketplace, a
  // single result) left the footer stranded wherever the content happened to end, with a
  // huge dead gap below it on any tall/wide monitor instead of sitting at the bottom of the
  // viewport. This only affects pages shorter than the viewport — taller pages scroll as before.
  return (
    <div className="min-h-screen flex flex-col text-slate-100" style={{ background: 'radial-gradient(ellipse 1200px 800px at 50% -10%, var(--eth-night3) 0%, var(--eth-night2) 40%, var(--eth-night1) 100%)' }}>
      {showBoot && <BootScreen progress={bootProgress} leaving={bootLeaving} onSkip={() => bootProgress >= 100 && exitBoot()} />}
      {dbDown && <DbDownBanner api={api} onRecovered={() => { setDbDown(false); window.location.reload() }} />}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full blur-[120px]" style={{ background: 'rgba(192,132,252,0.08)' }} />
        <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full blur-[120px]" style={{ background: 'rgba(244,114,182,0.08)' }} />
      </div>

      <header className="sticky top-0 z-40 backdrop-blur-xl border-b" style={{ background: 'rgba(20,10,36,0.85)', borderColor: 'rgba(107,33,168,0.25)' }}>
        <div className="container mx-auto px-4 h-16 flex items-center gap-4">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="lg:hidden -ml-2 p-2.5 shrink-0 text-slate-300 hover:text-white transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Logo onClick={() => go('browse')} compactOnMobile />
          {/* lg, not md: measured — Logo + 4 nav buttons + Login/Sign Up genuinely don't fit
              in 768px (they need ~780px), so the md breakpoint overflowed the header
              horizontally. The mobile drawer covers everything below lg instead. */}
          <nav className="hidden lg:flex items-center gap-1 ml-2">
            {NAV_ITEMS.map(([name, label]) => (
              <button key={name} onClick={() => go(name)} className="font-pixel text-[10px] tracking-wider px-3.5 py-2.5 border border-transparent transition-colors" style={{ color: 'var(--eth-muted)' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--eth-ink)'; e.currentTarget.style.borderColor = 'rgba(107,33,168,0.5)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--eth-muted)'; e.currentTarget.style.borderColor = 'transparent' }}>{label.toUpperCase()}</button>
            ))}
            {user?.isAdmin && <button onClick={() => go('admin')} className="font-pixel text-[10px] tracking-wider px-3.5 py-2.5" style={{ color: 'var(--eth-gold)' }}>ADMIN</button>}
          </nav>
          <div className="flex-1" />
          {booting ? null : user ? (
            <div className="flex items-center gap-2">
              <Badge className="hidden sm:flex gap-1 border" style={{ background: 'rgba(168,85,247,0.1)', color: 'var(--eth-gold)', borderColor: 'rgba(168,85,247,0.25)' }}><Bitcoin className="w-3.5 h-3.5" /> Crypto</Badge>
              <Button size="icon" variant="ghost" className="relative text-slate-300" onClick={async () => { setNotifOpen(true); await api('/notifications/read', { method: 'POST' }); setNotifications(n => n.map(x => ({ ...x, read: true }))) }}>
                <Bell className="w-5 h-5" />
                {unread > 0 && <span className="absolute top-1 right-1 w-4 h-4 text-[10px] rounded-full flex items-center justify-center font-bold" style={{ background: 'var(--eth-lavender)' }}>{unread}</span>}
              </Button>
              <button onClick={() => go('dashboard')} className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full hover:bg-white/5 border" style={{ borderColor: 'rgba(107,33,168,0.2)' }}>
                <Avatar className="w-8 h-8"><AvatarImage src={user.avatarUrl} /><AvatarFallback>{user.username[0]}</AvatarFallback></Avatar>
                <span className="text-sm font-semibold hidden sm:block">{user.username}</span>
              </button>
              <Button size="icon" variant="ghost" className="text-slate-400" onClick={logout}><LogOut className="w-4 h-4" /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" className="text-slate-200" onClick={() => { setAuthMode('login'); setAuthOpen(true) }}>Login</Button>
              <Button className="font-semibold border-0" style={{ background: 'linear-gradient(90deg, var(--eth-gold), var(--eth-teal))', color: 'var(--eth-night1)' }} onClick={() => { setAuthMode('signup'); setAuthOpen(true) }}>Sign Up</Button>
            </div>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1">
        {view.name === 'browse' && <BrowseView api={api} go={go} initialCategory={view.category} initialSearch={view.search} />}
        {view.name === 'toycodes' && <ToyCodesView api={api} go={go} requireAuth={requireAuth} user={user} />}
        {view.name === 'toycode' && <ToyCodeDetailView api={api} go={go} id={view.id} requireAuth={requireAuth} user={user} />}
        {view.name === 'profiles-store' && <AccountsStoreView api={api} go={go} requireAuth={requireAuth} />}
        {view.name === 'profile' && <ProfileDetailView api={api} go={go} id={view.id} requireAuth={requireAuth} />}
        {view.name === 'item' && <ItemView api={api} go={go} listingId={view.listingId} user={user} requireAuth={requireAuth} cfg={cfg} />}
        {view.name === 'order' && <OrderStatusView api={api} go={go} orderId={view.orderId} refreshNotifs={loadNotifs} cfg={cfg} />}
        {view.name === 'seller' && <SellerView api={api} go={go} name={view.username} />}
        {view.name === 'reviews' && <ReviewsView api={api} />}
        {view.name === 'dashboard' && (user ? <DashboardView api={api} go={go} user={user} /> : <EmptyAuth onLogin={() => { setAuthMode('login'); setAuthOpen(true) }} />)}
        {view.name === 'admin' && <AdminView api={api} user={user} go={go} cfg={cfg} initialTab={view.tab} />}
        {view.name === 'admin-account' && <AdminAccountView api={api} go={go} id={view.id} user={user} />}
      </main>

      <footer className="relative z-10 border-t mt-20 py-10" style={{ borderColor: 'rgba(107,33,168,0.2)' }}>
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6 text-sm" style={{ color: 'var(--eth-muted)' }}>
          <Logo onClick={() => go('browse')} />
          {/* min-w-0: a flex child with text defaults to a min-width based on its content,
              not 0 — without this the footer's middle block refused to shrink below its
              un-wrapped width and pushed the Discord block past the right edge at ~768px. */}
          <div className="text-center max-w-xl space-y-1.5 min-w-0">
            <p>An original marketplace demo. Not affiliated with or endorsed by Roblox Corporation. Payments are processed in cryptocurrency via CoinGate.</p>
            <div className="flex items-center justify-center gap-1.5 font-pixel text-[8px] tracking-wider">
              <button onClick={() => setLegalOpen('privacy')} className="hover:text-[var(--eth-gold)] transition-colors">PRIVACY POLICY</button>
              <span style={{ color: 'var(--eth-gold-dim)' }}>·</span>
              <button onClick={() => setLegalOpen('tos')} className="hover:text-[var(--eth-gold)] transition-colors">TERMS OF SERVICE</button>
              <span style={{ color: 'var(--eth-gold-dim)' }}>·</span>
              <button onClick={() => setLegalOpen('disclaimer')} className="hover:text-[var(--eth-gold)] transition-colors">ROBLOX DISCLAIMER</button>
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <a href={DISCORD_INVITE} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 px-3.5 py-2 border transition-colors hover:border-[var(--eth-gold)]" style={{ borderColor: 'var(--eth-gold-dim)', background: 'rgba(192,132,252,0.06)' }}>
              <DiscordIcon className="w-5 h-5" style={{ color: 'var(--eth-teal)' }} />
              <div className="text-left leading-tight">
                <p className="font-pixel text-[7px] tracking-widest">JOIN THE SERVER</p>
                <p className="font-cinzel font-semibold text-sm" style={{ color: 'var(--eth-ink)' }}>Discord</p>
              </div>
            </a>
            <span className="flex items-center gap-1"><Bitcoin className="w-3.5 h-3.5" /> Crypto payments</span>
          </div>
        </div>
      </footer>

      <ConsentPopup onOpenLegal={setLegalOpen} />
      <LegalDialog which={legalOpen} onClose={() => setLegalOpen(null)} />
      <SupportChat api={api} user={user} />
      <AuthDialog open={authOpen} setOpen={setAuthOpen} mode={authMode} setMode={setAuthMode} api={api} onAuthed={async (u) => { setUser(u); setAuthOpen(false); await loadNotifs(); toast.success(`Welcome, ${u.username}!`); if (u.isAdmin) go('admin') }} />
      <NotifDialog open={notifOpen} setOpen={setNotifOpen} notifications={notifications} />
      <MobileNavSheet open={mobileNavOpen} setOpen={setMobileNavOpen} go={go} user={user} />
    </div>
  )
}

// Shown when the API reports it can't reach the database. Polls /config in the background
// and reloads automatically the moment the database comes back, so the user isn't left
// staring at a dead page wondering whether to refresh.
function DbDownBanner({ api, onRecovered }) {
  const [checking, setChecking] = useState(false)
  const retry = useCallback(async () => {
    setChecking(true)
    try { await api('/config'); onRecovered() } catch {} finally { setChecking(false) }
  }, [api, onRecovered])
  useEffect(() => { const iv = setInterval(retry, 15000); return () => clearInterval(iv) }, [retry])
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] px-4 py-2.5 flex items-center justify-center gap-3 text-sm"
      style={{ background: 'rgba(120,40,30,0.97)', borderBottom: '1px solid rgba(168,85,247,0.4)', color: 'var(--eth-ink)' }}>
      <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--eth-gold)' }} />
      <span>Can&rsquo;t reach the database — listings and sign-in are unavailable. Retrying automatically.</span>
      <button onClick={retry} disabled={checking} className="font-pixel text-[8px] tracking-wider px-2.5 py-1 border disabled:opacity-50" style={{ borderColor: 'var(--eth-gold)' }}>
        {checking ? 'CHECKING…' : 'RETRY NOW'}
      </button>
    </div>
  )
}

const CONSENT_KEY = 'eth_legal_ack_v1'

function ConsentPopup({ onOpenLegal }) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    try { if (!localStorage.getItem(CONSENT_KEY)) setVisible(true) } catch { setVisible(true) }
  }, [])

  const acknowledge = () => {
    try { localStorage.setItem(CONSENT_KEY, '1') } catch {}
    setLeaving(true)
    setTimeout(() => setVisible(false), 300)
  }

  if (!visible) return null
  const items = [['privacy', 'Privacy Policy'], ['tos', 'Terms of Service'], ['disclaimer', 'Roblox Disclaimer']]

  return (
    <div className={`fixed bottom-4 left-4 right-4 sm:right-auto sm:w-[400px] z-40 transition-all duration-300 ${leaving ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0'}`}>
      <div className="border-2 p-4" style={{ background: 'rgba(20,10,36,0.97)', borderColor: 'var(--eth-gold-dim)', boxShadow: '0 10px 40px -10px rgba(0,0,0,0.6)' }}>
        <p className="font-cinzel font-semibold text-sm mb-1.5" style={{ color: 'var(--eth-ink)' }}>Before you continue</p>
        <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--eth-muted)' }}>
          Ethereal is an independent fan-made marketplace, not affiliated with Roblox Corporation. By using this site you agree to our{' '}
          <button onClick={() => onOpenLegal('privacy')} className="underline underline-offset-2 hover:text-[var(--eth-gold)]">Privacy Policy</button> and{' '}
          <button onClick={() => onOpenLegal('tos')} className="underline underline-offset-2 hover:text-[var(--eth-gold)]">Terms of Service</button>.
        </p>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 font-pixel text-[7px] tracking-wider" style={{ color: 'var(--eth-muted)' }}>
            {items.map(([key, label], i) => (
              <span key={key} className="flex items-center gap-1.5">
                <button onClick={() => onOpenLegal(key)} className="hover:text-[var(--eth-gold)] transition-colors">{label.toUpperCase()}</button>
                {i < items.length - 1 && <span style={{ color: 'var(--eth-gold-dim)' }}>·</span>}
              </span>
            ))}
          </div>
          <Button size="sm" onClick={acknowledge} className="rounded-none font-semibold shrink-0" style={{ background: 'linear-gradient(90deg, var(--eth-gold), var(--eth-lavender))', color: 'var(--eth-night1)' }}>Acknowledge</Button>
        </div>
      </div>
    </div>
  )
}

function DiscordIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.927 1.793 8.18 1.793 12.061 0a.073.073 0 0 1 .078.01c.12.099.246.197.373.291a.077.077 0 0 1-.006.128c-.599.35-1.222.645-1.873.892a.076.076 0 0 0-.04.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.662a.06.06 0 0 0-.031-.028ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.333-.955 2.418-2.157 2.418Zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  )
}

const CHAT_GUEST_KEY = 'eth_guest_id'
function getGuestId() {
  if (typeof window === 'undefined') return null
  try {
    let id = localStorage.getItem(CHAT_GUEST_KEY)
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : `g-${Date.now()}-${Math.random().toString(36).slice(2)}`); localStorage.setItem(CHAT_GUEST_KEY, id) }
    return id
  } catch { return `g-${Date.now()}` }
}

function SupportChat({ api, user }) {
  const [open, setOpen] = useState(false)
  const [threadId, setThreadId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [unread, setUnread] = useState(false)
  const [needsCaptcha, setNeedsCaptcha] = useState(false)
  const [captcha, setCaptcha] = useState({ captchaId: null, captchaAnswer: '' })
  const [captchaNonce, setCaptchaNonce] = useState(0)
  const guestIdRef = useRef(null)
  const scrollRef = useRef(null)
  if (guestIdRef.current === null) guestIdRef.current = getGuestId()

  // Guests only need to clear a CAPTCHA to open a brand-new thread — resuming an existing
  // one, or being logged in, sails through on the first (uncaptcha'd) attempt.
  const startThread = useCallback(async (withCaptcha) => {
    try {
      const body = { guestId: guestIdRef.current, ...(withCaptcha || {}) }
      const d = await api('/chat/start', { method: 'POST', body: JSON.stringify(body) })
      setNeedsCaptcha(false)
      setThreadId(d.threadId)
      return d.threadId
    } catch (e) {
      if (e.message && /captcha/i.test(e.message)) { setNeedsCaptcha(true); setCaptchaNonce(n => n + 1) }
      return null
    }
  }, [api])

  const ensureThread = useCallback(async () => {
    if (threadId) return threadId
    return startThread()
  }, [threadId, startThread])

  const solveCaptchaAndStart = async () => {
    if (!captcha.captchaAnswer) { toast.error('Solve the CAPTCHA to continue'); return }
    setSending(true)
    const tid = await startThread(captcha)
    setSending(false)
    if (tid) poll(tid)
  }

  const poll = useCallback(async (id) => {
    const tid = id || threadId
    if (!tid) return
    try {
      const d = await api(`/chat/${tid}/messages?guestId=${encodeURIComponent(guestIdRef.current)}`)
      setMessages(prev => {
        if (!open && d.messages.length > prev.length && prev.length > 0 && d.messages[d.messages.length - 1].sender === 'staff') setUnread(true)
        return d.messages
      })
    } catch {}
  }, [api, threadId, open])

  useEffect(() => { ensureThread().then(id => id && poll(id)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!threadId) return
    const iv = setInterval(() => poll(threadId), open ? 4000 : 15000)
    return () => clearInterval(iv)
  }, [threadId, open, poll])

  useEffect(() => { if (open) { setUnread(false); poll(threadId) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages, open])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const tid = await ensureThread()
      if (!tid) return
      setInput('')
      const d = await api(`/chat/${tid}/messages`, { method: 'POST', body: JSON.stringify({ text, guestId: guestIdRef.current }) })
      setMessages(prev => [...prev, d.message])
    } catch (e) { toast.error(e.message) } finally { setSending(false) }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-40 w-[calc(100vw-2rem)] sm:w-[360px] h-[480px] max-h-[70vh] flex flex-col border-2" style={{ background: 'rgba(20,10,36,0.98)', borderColor: 'var(--eth-gold-dim)', boxShadow: '0 10px 40px -10px rgba(0,0,0,0.6)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(107,33,168,0.3)' }}>
            <div>
              <p className="font-cinzel font-semibold text-sm" style={{ color: 'var(--eth-ink)' }}>Support</p>
              <p className="text-[11px]" style={{ color: 'var(--eth-muted)' }}>We usually reply within a few minutes</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
            {needsCaptcha && !threadId ? (
              <div className="py-4 px-1">
                <p className="text-xs mb-3 text-center" style={{ color: 'var(--eth-muted)' }}>Quick check before we start — solve this to open a chat.</p>
                <Captcha key={captchaNonce} api={api} onChange={setCaptcha} />
                <Button size="sm" onClick={solveCaptchaAndStart} disabled={sending || !captcha.captchaAnswer} className="w-full mt-3 rounded-none font-semibold" style={{ background: 'linear-gradient(90deg, var(--eth-gold), var(--eth-lavender))', color: 'var(--eth-night1)' }}>
                  {sending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Start chat'}
                </Button>
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-8 px-4">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" style={{ color: 'var(--eth-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--eth-muted)' }}>Ask us anything about orders, toy codes, or delivery — a real person will get back to you here.</p>
              </div>
            ) : messages.map(m => (
              <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%] px-3 py-2 text-sm leading-relaxed" style={m.sender === 'user'
                  ? { background: 'linear-gradient(90deg, var(--eth-gold), var(--eth-lavender))', color: 'var(--eth-night1)' }
                  : { background: 'rgba(192,132,252,0.12)', border: '1px solid rgba(192,132,252,0.3)', color: 'var(--eth-ink)' }}>
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          <div className="px-3 py-2 border-t flex items-center gap-1.5" style={{ borderColor: 'rgba(107,33,168,0.3)' }}>
            <a href={DISCORD_INVITE} target="_blank" rel="noreferrer" className="text-[10px] flex items-center gap-1 hover:text-[var(--eth-gold)] transition-colors" style={{ color: 'var(--eth-muted)' }}>
              <DiscordIcon className="w-3 h-3" /> Faster on Discord
            </a>
          </div>
          <div className="px-3 pb-3 pt-1 flex items-center gap-2">
            <Input disabled={needsCaptcha && !threadId} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Type a message..." className="bg-black/30 border-white/10 h-9 text-sm" />
            <Button size="icon" disabled={sending || !input.trim() || (needsCaptcha && !threadId)} onClick={send} className="h-9 w-9 shrink-0 rounded-none" style={{ background: 'linear-gradient(90deg, var(--eth-gold), var(--eth-lavender))' }}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--eth-night1)' }} /> : <Send className="w-4 h-4" style={{ color: 'var(--eth-night1)' }} />}
            </Button>
          </div>
        </div>
      )}

      <button onClick={() => setOpen(v => !v)} className="fixed bottom-6 right-4 sm:right-6 z-40 w-14 h-14 rounded-full flex items-center justify-center transition-transform hover:scale-105"
        style={{ background: 'linear-gradient(135deg, var(--eth-gold), var(--eth-lavender))', boxShadow: '0 6px 24px -6px rgba(168,85,247,0.6)' }}>
        {open ? <X className="w-5 h-5" style={{ color: 'var(--eth-night1)' }} /> : <MessageSquare className="w-5 h-5" style={{ color: 'var(--eth-night1)' }} />}
        {unread && !open && <span className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-red-500 border-2" style={{ borderColor: 'var(--eth-night1)' }} />}
      </button>
    </>
  )
}

const LEGAL_CONTENT = {
  privacy: {
    title: 'Privacy Policy',
    body: [
      ["What we collect", "Your email and username when you create an account; your Discord username and Discord ID when you place an order, so we can verify and deliver to the right person; your Roblox username when a listing requires it; and basic order metadata (item, price, status, timestamps)."],
      ["Payments", "Crypto checkout is processed by a third-party payment processor. We never see or store your wallet's private keys, card numbers, or bank details — only the payment status and amount they report back to us."],
      ["How we use it", "Solely to create your account, fulfil and verify orders, prevent fraud (like someone else claiming your order), and show you your own purchase history. We don't sell or share your data with advertisers."],
      ["What we store locally", "A sign-in token in your browser's local storage, so you stay logged in. Clearing your browser data signs you out."],
      ["Your choices", "You can ask us to delete your account and associated data at any time via Discord support."],
    ],
  },
  tos: {
    title: 'Terms of Service',
    body: [
      ["The service", "Ethereal is an independent marketplace demo for buying and selling Roblox-related digital items and codes. By using the site you agree to these terms."],
      ["Accounts", "You're responsible for keeping your login and Discord access secure. One account per person; don't share credentials."],
      ["Payments & delivery", "All purchases are paid in cryptocurrency and are final once confirmed on-chain. Digital items (toy codes, accounts, marketplace items) are delivered via Discord using the /claim command — we verify your Discord identity before releasing anything."],
      ["Prohibited use", "No fraud, chargebacks in bad faith, scraping, or attempting to access another user's order or account."],
      ["No warranty", "The service and all listings are provided \"as is\" — we don't guarantee uninterrupted availability or that every third-party item description is error-free."],
      ["Changes", "We may update these terms as the service evolves; continued use after a change means you accept the update."],
    ],
  },
  disclaimer: {
    title: 'Roblox Disclaimer',
    body: [
      ["Independent & unaffiliated", "Ethereal is an original, independently operated marketplace. We are not affiliated with, sponsored by, endorsed by, or in any way officially connected to Roblox Corporation."],
      ["Trademarks", "\"Roblox\" and all related names, marks, and logos are trademarks of Roblox Corporation. We reference them only to describe the items and services we offer."],
      ["Off-platform activity", "All listings, payments, and deliveries on Ethereal happen off the Roblox platform, via this site and Discord — Roblox Corporation has no involvement in, and bears no responsibility for, any transaction made here."],
      ["Your responsibility", "Using third-party marketplaces may carry risk under Roblox's own Terms of Use. It's your responsibility to understand and comply with Roblox's rules when using their platform."],
    ],
  },
}

function LegalDialog({ which, onClose }) {
  const content = which ? LEGAL_CONTENT[which] : null
  return (
    <Dialog open={!!which} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#140a24] border-[#6b21a8]/40 text-slate-100 max-w-lg max-h-[80vh] overflow-y-auto rounded-none">
        {content && (
          <>
            <DialogHeader>
              <DialogTitle className="font-cinzel font-bold text-xl tracking-wide" style={{ color: 'var(--eth-ink)' }}>{content.title}</DialogTitle>
              <DialogDescription className="sr-only">{content.title}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {content.body.map(([heading, text]) => (
                <div key={heading}>
                  <p className="font-pixel text-[9px] tracking-widest mb-1.5" style={{ color: 'var(--eth-gold)' }}>{heading.toUpperCase()}</p>
                  <p className="text-sm text-slate-300 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Captcha({ api, onChange }) {
  const [svg, setSvg] = useState('')
  const [answer, setAnswerState] = useState('')
  const [loading, setLoading] = useState(true)
  const idRef = useRef(null)
  // Guards against out-of-order responses: if load() is called again (double-mount in dev,
  // or a user hitting refresh twice quickly) before the first call resolves, only the reply
  // to the LATEST call may ever update state — an older one arriving late is discarded.
  const genRef = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    const myGen = ++genRef.current
    try {
      const d = await api('/captcha/new')
      if (genRef.current !== myGen) return
      idRef.current = d.captchaId
      setSvg(d.svg)
      setAnswerState('')
      onChange({ captchaId: d.captchaId, captchaAnswer: '' })
    } catch {} finally { if (genRef.current === myGen) setLoading(false) }
  }, [api]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setAnswer = (v) => { setAnswerState(v); onChange({ captchaId: idRef.current, captchaAnswer: v }) }

  return (
    <div>
      <Label className="text-slate-300 text-xs">Quick check — solve to continue</Label>
      <div className="flex items-center gap-2 mt-1">
        {loading
          ? <div className="w-[140px] h-[50px] bg-black/30 animate-pulse shrink-0" />
          : <div className="shrink-0 border leading-none" style={{ borderColor: 'var(--eth-gold-dim)' }} dangerouslySetInnerHTML={{ __html: svg }} />}
        <button type="button" onClick={load} className="text-slate-400 hover:text-[var(--eth-gold)] shrink-0" title="New challenge"><RefreshCw className="w-4 h-4" /></button>
        <Input value={answer} onChange={e => setAnswer(e.target.value.replace(/[^0-9-]/g, ''))} placeholder="Answer" className="bg-black/30 border-white/10" />
      </div>
    </div>
  )
}

const RESEND_COOLDOWN_SECONDS = 60

function AuthDialog({ open, setOpen, mode, setMode, api, onAuthed }) {
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [needsTotp, setNeedsTotp] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [captcha, setCaptcha] = useState({ captchaId: null, captchaAnswer: '' })
  const [captchaNonce, setCaptchaNonce] = useState(0)
  // Signup no longer logs the user in directly — the account is pending until the code
  // is verified — so a successful signup moves here instead of closing the dialog.
  const [needsVerification, setNeedsVerification] = useState(false)
  const [verifyEmail, setVerifyEmail] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  const reset = () => {
    setNeedsTotp(false); setTotpCode('')
    setNeedsVerification(false); setVerifyEmail(''); setVerifyCode(''); setResendCooldown(0)
    setForm({ username: '', email: '', password: '' })
  }

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setInterval(() => setResendCooldown(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [resendCooldown > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!needsTotp && !captcha.captchaAnswer) { toast.error('Solve the CAPTCHA to continue'); return }
    setLoading(true)
    try {
      const path = mode === 'signup' ? '/auth/signup' : '/auth/login'
      const body = mode === 'signup'
        ? { ...form, ...captcha }
        : { email: form.email, password: form.password, totpCode: needsTotp ? totpCode.trim() : undefined, ...(needsTotp ? {} : captcha) }
      const d = await api(path, { method: 'POST', body: JSON.stringify(body) })
      if (d.requiresTotp) { setNeedsTotp(true); setLoading(false); return }
      if (mode === 'signup') {
        // Signup always answers with the same generic "check your email" message, whether
        // or not the account already existed — that's intentional (avoids leaking which
        // emails are registered), so this step just always moves on to code entry.
        setVerifyEmail(form.email.trim().toLowerCase())
        setNeedsVerification(true)
        setResendCooldown(RESEND_COOLDOWN_SECONDS)
        setLoading(false)
        return
      }
      // An unverified account signing in means verification was abandoned earlier — the tab
      // was closed, the email was lost. Route them straight back into the code step instead
      // of completing the sign-in: a half-verified session was a dead end, since purchases
      // 403 and the verify UI only ever existed inside the signup flow. The token from this
      // response is deliberately dropped; verify-email issues a fresh one on success.
      if (d.user && d.user.emailVerified === false) {
        setVerifyEmail(String(d.user.email || form.email).trim().toLowerCase())
        setNeedsVerification(true)
        setResendCooldown(0) // the code from their original signup may still be live
        setLoading(false)
        toast.info('Please verify your email to finish signing in.')
        return
      }
      localStorage.setItem('rbx_token', d.token); onAuthed(d.user); reset()
    } catch (e) {
      toast.error(e.message)
      if (!needsTotp) setCaptchaNonce(n => n + 1) // fresh challenge — the old one is single-use
    } finally { setLoading(false) }
  }

  const submitVerify = async () => {
    if (verifyCode.length !== 6) return
    setLoading(true)
    try {
      const d = await api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ email: verifyEmail, code: verifyCode }) })
      localStorage.setItem('rbx_token', d.token); onAuthed(d.user); reset()
      toast.success('Email verified — welcome to Ethereal!')
    } catch (e) {
      toast.error(e.message)
      setVerifyCode('')
    } finally { setLoading(false) }
  }

  const resendCode = async () => {
    if (resendCooldown > 0) return
    setResendCooldown(RESEND_COOLDOWN_SECONDS)
    try {
      await api('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: verifyEmail }) })
      toast.success('New code sent — check your email.')
    } catch (e) {
      toast.error(e.message)
    }
  }

  if (needsVerification) {
    return (
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
          <DialogHeader><DialogTitle className="text-2xl font-black flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400" /> Verify your email</DialogTitle>
            <DialogDescription className="text-slate-400">We sent a 6-digit code to <span className="text-slate-200">{verifyEmail}</span>. Enter it below — it expires in 10 minutes.</DialogDescription></DialogHeader>
          <div>
            <Label className="text-slate-300">Verification code</Label>
            <Input
              className="bg-black/30 border-white/10 mt-1 font-mono tracking-widest text-lg text-center"
              value={verifyCode}
              onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              onKeyDown={e => e.key === 'Enter' && submitVerify()}
              autoFocus
            />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button disabled={loading || verifyCode.length < 6} onClick={submitVerify} className="w-full bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify & Continue'}
            </Button>
            <button
              className="text-sm text-slate-400 hover:text-[#c084fc] disabled:opacity-50 disabled:hover:text-slate-400"
              disabled={resendCooldown > 0}
              onClick={resendCode}
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
            </button>
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={reset}>Back to sign up</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  if (needsTotp) {
    return (
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
          <DialogHeader><DialogTitle className="text-2xl font-black flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400" /> Two-factor verification</DialogTitle>
            <DialogDescription className="text-slate-400">Enter the current code from your authenticator app to finish signing in.</DialogDescription></DialogHeader>
          <div><Label className="text-slate-300">Authenticator code</Label><Input className="bg-black/30 border-white/10 mt-1 font-mono tracking-widest" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" onKeyDown={e => e.key === 'Enter' && submit()} /></div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button disabled={loading || totpCode.length < 6} onClick={submit} className="w-full bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify & Sign In'}</Button>
            <button className="text-sm text-slate-400 hover:text-[#c084fc]" onClick={reset}>Back</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
        <DialogHeader><DialogTitle className="text-2xl font-black">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</DialogTitle>
          <DialogDescription className="text-slate-400">{mode === 'signup' ? 'Join to buy items and pay with crypto.' : 'Sign in to shop the marketplace.'}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {mode === 'signup' && <div><Label className="text-slate-300">Username</Label><Input className="bg-black/30 border-white/10 mt-1" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="coolgamer99" /></div>}
          <div><Label className="text-slate-300">Email</Label><Input className="bg-black/30 border-white/10 mt-1" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></div>
          <div><Label className="text-slate-300">Password</Label><Input type="password" className="bg-black/30 border-white/10 mt-1" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="********" onKeyDown={e => e.key === 'Enter' && submit()} /></div>
          <Captcha key={captchaNonce} api={api} onChange={setCaptcha} />
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={loading} onClick={submit} className="w-full bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (mode === 'signup' ? 'Create Account' : 'Sign In')}</Button>
          <button className="text-sm text-slate-400 hover:text-[#c084fc]" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NotifDialog({ open, setOpen, notifications }) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Notifications</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {notifications.length === 0 && <p className="text-slate-400 text-sm py-6 text-center">No notifications yet.</p>}
          {notifications.map(n => (
            <div key={n.id} className="p-3 rounded-lg bg-black/30 border border-[#6b21a8]/40 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <div><p className="text-sm">{n.text}</p><p className="text-xs text-slate-500 mt-0.5">{new Date(n.createdAt).toLocaleString()}</p></div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EmptyAuth({ onLogin }) {
  return (
    <div className="container mx-auto px-4 py-32 text-center">
      <User className="w-12 h-12 mx-auto text-[#c084fc] mb-4" />
      <h2 className="text-2xl font-bold mb-2">Sign in to view your dashboard</h2>
      <Button onClick={onLogin} className="mt-4 bg-gradient-to-r from-[#c084fc] to-[#f472b6]">Sign In</Button>
    </div>
  )
}

function HomeView({ api, go }) {
  const [trending, setTrending] = useState([])
  const [search, setSearch] = useState('')
  useEffect(() => { api('/listings?sort=popular').then(d => setTrending((d.listings || []).slice(0, 10))).catch(() => {}) }, [api])
  return (
    <div>
      <section className="relative overflow-hidden">
        <img src="https://images.unsplash.com/photo-1563089145-599997674d42?auto=format&fit=crop&w=1600&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0912]/60 via-[#0a0912]/80 to-[#0a0912]" />
        <div className="container mx-auto px-4 py-24 md:py-32 relative">
          <div className="max-w-3xl mx-auto text-center">
            <Badge className="mb-5 bg-[#c084fc]/15 text-[#c084fc] border-[#c084fc]/30 px-4 py-1.5 text-sm"><Sparkles className="w-3.5 h-3.5 mr-1.5" /> The marketplace for Roblox collectors</Badge>
            <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-5 leading-[1.05]">Discover items.<br />Find deals.<br /><span className="bg-gradient-to-r from-[#c084fc] via-[#f472b6] to-[#f472b6] bg-clip-text text-transparent">Pay with crypto.</span></h1>
            <p className="text-lg text-slate-400 mb-8 max-w-xl mx-auto">Buy limiteds, UGC, accessories and collectibles. Prices in USD & Robux, checkout in Bitcoin, Ethereum, USDT & more.</p>
            <div className="flex gap-2 max-w-xl mx-auto">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <Input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && go('browse', { search })} placeholder="Search for an item..." className="pl-12 h-14 bg-[#12101f]/90 border-white/10 text-base rounded-xl" />
              </div>
              <Button onClick={() => go('browse', { search })} className="h-14 px-8 bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-bold text-base rounded-xl">Search</Button>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black flex items-center gap-2"><TrendingUp className="w-6 h-6 text-[#f472b6]" /> Trending</h2>
          <Button variant="ghost" className="text-[#c084fc]" onClick={() => go('browse')}>View all</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {trending.length === 0 ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="aspect-[3/4] rounded-xl bg-white/5 animate-pulse" />) : trending.slice(0, 5).map(l => <ItemCard key={l.id} listing={l} onOpen={() => go('item', { listingId: l.id })} />)}
        </div>
      </section>

      <section className="container mx-auto px-4 py-8">
        <h2 className="text-2xl font-black mb-6 flex items-center gap-2"><LayoutGrid className="w-6 h-6 text-[#c084fc]" /> Popular Categories</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {CATEGORIES.filter(c => c !== 'All').map(cat => {
            const Icon = CAT_ICONS[cat] || Tag
            return (
              <button key={cat} onClick={() => go('browse', { category: cat })} className="group p-6 rounded-2xl bg-gradient-to-br from-[#15121f] to-[#0f0d18] border border-[#6b21a8]/40 hover:border-[#c084fc]/40 transition-all hover:-translate-y-1">
                <Icon className="w-8 h-8 mb-3 text-[#c084fc] group-hover:text-[#f472b6] transition-colors" /><p className="font-bold">{cat}</p>
              </button>
            )
          })}
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="grid md:grid-cols-3 gap-6">
          {[[Search, 'Browse & Discover', 'Explore a curated catalog with smart search, filters and sorting.'],
            [Bitcoin, 'Pay with Crypto', 'Checkout securely in BTC, ETH, USDT, USDC and more via CoinGate.'],
            [Shield, 'Verified Listings', 'Every item is reviewed and listed by our trusted admin team.']].map(([Icon, title, desc], i) => (
            <Card key={i} className="p-6 bg-[#140a24]/60 border-[#6b21a8]/40 rounded-none">
              <div className="w-11 h-11 rounded-xl bg-[#c084fc]/15 flex items-center justify-center mb-4"><Icon className="w-5 h-5 text-[#c084fc]" /></div>
              <h3 className="font-bold text-lg mb-1">{title}</h3><p className="text-slate-400 text-sm">{desc}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}

function MarketCard({ listing, onOpen }) {
  const sold = listing.status && listing.status !== 'active'
  const rarity = rarityFor(listing)
  return (
    <Card onClick={() => onOpen(listing)} className="group relative overflow-hidden rounded-none border-2 transition-all cursor-pointer"
      style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.5), rgba(20,10,36,0.85))', borderColor: rarity.color, boxShadow: `0 0 0 rgba(0,0,0,0)` }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 30px -10px ${rarity.color}80` }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 0 0 rgba(0,0,0,0)' }}>
      <div className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center border" style={{ background: 'rgba(0,0,0,0.5)', borderColor: 'rgba(168,85,247,0.3)' }} title="Crypto accepted"><Bitcoin className="w-3.5 h-3.5" style={{ color: 'var(--eth-gold)' }} /></div>
      {typeof listing.stock === 'number' && listing.status === 'active' && <div className="absolute top-3 left-3 z-10 font-pixel text-[8px] px-2 py-1 border" style={{ background: 'rgba(0,0,0,0.5)', borderColor: 'rgba(168,85,247,0.3)', color: 'var(--eth-muted)' }}>{listing.stock} LEFT</div>}
      <div className="p-4 pb-2">
        <div className="aspect-square overflow-hidden" style={{ background: `radial-gradient(circle, ${rarity.color}22, transparent 70%)` }}>
          <img src={listing.item.imageUrl} alt={listing.item.name} className="w-full h-full object-cover group-hover:scale-[1.06] transition-transform duration-500" />
        </div>
      </div>
      <div className="px-4 pb-4">
        <p className="font-vt text-lg text-center truncate" style={{ color: 'var(--eth-ink)' }}>{listing.item.name}</p>
        <p className="font-pixel text-[8px] tracking-widest text-center mt-1.5 mb-3" style={{ color: rarity.color }}>{rarity.label}</p>
        <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div><p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--eth-muted)' }}>RAP</p><p className="font-vt text-base" style={{ color: 'var(--eth-ink)' }}>{listing.rap != null ? Number(listing.rap).toLocaleString() : '—'}</p></div>
          <div className="text-right"><p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--eth-muted)' }}>From</p><p className="font-vt text-xl" style={{ color: 'var(--eth-gold)' }}>{usd(listing.price)}</p></div>
        </div>
      </div>
      {sold && <div className="absolute inset-0 bg-black/65 flex items-center justify-center"><Badge className="bg-red-500/90 text-white">SOLD</Badge></div>}
    </Card>
  )
}

function SoldStripCard({ listing }) {
  return (
    <div className="relative shrink-0 w-36 rounded-xl bg-[#0e0d16] border border-white/[0.06] p-3">
      <span className="absolute top-2 left-2 z-10 text-[11px] font-black text-emerald-400 bg-black/70 px-2 py-0.5 rounded-md border border-[#6b21a8]/40">{usd(listing.price)}</span>
      <div className="aspect-square rounded-lg overflow-hidden mb-2 bg-white/[0.03]"><img src={listing.item.imageUrl} className="w-full h-full object-cover" alt="" /></div>
      <p className="text-xs font-medium text-center truncate text-slate-300">{listing.item.name}</p>
    </div>
  )
}

function BrowseView({ api, go, initialCategory, initialSearch }) {
  const [listings, setListings] = useState([])
  const [trending, setTrending] = useState([])
  const [sold, setSold] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(initialSearch || '')
  const [category, setCategory] = useState(initialCategory || 'All')
  const [condition, setCondition] = useState('All')
  const [sort, setSort] = useState('newest')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  useEffect(() => {
    api('/sold').then(d => setSold(d.listings || [])).catch(() => {})
    api('/listings?sort=popular').then(d => setTrending((d.listings || []).slice(0, 10))).catch(() => {})
  }, [api])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (search) p.set('search', search)
      if (category !== 'All') p.set('category', category)
      if (condition !== 'All') p.set('condition', condition)
      if (minPrice) p.set('minPrice', minPrice)
      if (maxPrice) p.set('maxPrice', maxPrice)
      p.set('sort', sort)
      const d = await api(`/listings?${p.toString()}`); setListings(d.listings || [])
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }, [api, search, category, condition, sort, minPrice, maxPrice])
  useEffect(() => { load() }, [category, condition, sort])
  useEffect(() => { const t = setTimeout(load, 350); return () => clearTimeout(t) }, [search, minPrice, maxPrice])

  const reset = () => { setSearch(''); setCategory('All'); setCondition('All'); setSort('newest'); setMinPrice(''); setMaxPrice('') }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <aside className="md:w-60 shrink-0">
          <div className="md:sticky md:top-20 space-y-6">
            <div className="border-2 p-4" style={{ borderColor: 'var(--eth-gold-dim)', background: 'rgba(20,10,36,0.4)' }}>
              <h2 className="font-cinzel font-bold text-lg mb-3 tracking-wide" style={{ color: 'var(--eth-gold)' }}>Market</h2>
              <div className="space-y-0.5">
                {CATEGORIES.map(c => (
                  <button key={c} onClick={() => setCategory(c)} className="block w-full text-left px-3 py-2 text-sm font-medium transition-colors border"
                    style={category === c
                      ? { background: 'rgba(192,132,252,0.15)', color: 'var(--eth-teal)', borderColor: 'rgba(192,132,252,0.35)' }
                      : { color: 'var(--eth-muted)', borderColor: 'transparent' }}>
                    {c === 'All' ? 'All Items' : c}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-4 border-2 p-4" style={{ borderColor: 'var(--eth-gold-dim)', background: 'rgba(20,10,36,0.4)' }}>
              <h3 className="font-pixel text-[10px] tracking-widest" style={{ color: 'var(--eth-muted)' }}>FILTERS</h3>
              <div>
                <p className="text-xs mb-1.5" style={{ color: 'var(--eth-muted)' }}>Price (USD)</p>
                <div className="flex items-center gap-2">
                  <Input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="Min" className="bg-[#0e0d16] border-white/10 h-9" />
                  <span className="text-slate-600">-</span>
                  <Input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Max" className="bg-[#0e0d16] border-white/10 h-9" />
                </div>
              </div>
              <div>
                <p className="text-xs mb-1.5" style={{ color: 'var(--eth-muted)' }}>Condition</p>
                <Select value={condition} onValueChange={setCondition}><SelectTrigger className="bg-[#0e0d16] border-white/10 h-9"><SelectValue /></SelectTrigger><SelectContent className="bg-[#12101f] border-white/10 text-slate-100">{CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
              </div>
              <div>
                <p className="text-xs mb-1.5" style={{ color: 'var(--eth-muted)' }}>Sort by</p>
                <Select value={sort} onValueChange={setSort}><SelectTrigger className="bg-[#0e0d16] border-white/10 h-9"><SelectValue /></SelectTrigger><SelectContent className="bg-[#12101f] border-white/10 text-slate-100"><SelectItem value="newest">Newest</SelectItem><SelectItem value="popular">Most Popular</SelectItem><SelectItem value="price_asc">Price: Low to High</SelectItem><SelectItem value="price_desc">Price: High to Low</SelectItem></SelectContent></Select>
              </div>
              <Button variant="outline" onClick={reset} className="w-full rounded-none" style={{ borderColor: 'var(--eth-gold-dim)', color: 'var(--eth-gold)' }}>Reset Filters</Button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0 space-y-10">
          {/* Recently Sold */}
          {sold.length > 0 && (
            <section>
              <h2 className="font-pixel text-[10px] tracking-widest mb-3" style={{ color: 'var(--eth-muted)' }}>RECENTLY SOLD</h2>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">{sold.map(l => <SoldStripCard key={l.id} listing={l} />)}</div>
            </section>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--eth-muted)' }} />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the marketplace..." className="pl-12 h-12 bg-[#0e0d16] border-white/10 rounded-none text-base" />
          </div>

          {/* Trending */}
          {trending.length > 0 && (
            <section>
              <div className="flex items-center justify-center gap-4 mb-4">
                <span className="h-px flex-1" style={{ background: 'var(--eth-gold-dim)' }} />
                <h2 className="font-cinzel font-semibold text-xl tracking-wide flex items-center gap-2" style={{ color: 'var(--eth-ink)' }}><TrendingUp className="w-5 h-5" style={{ color: 'var(--eth-teal)' }} /> Trending Right Now</h2>
                <span className="h-px flex-1" style={{ background: 'var(--eth-gold-dim)' }} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">{trending.slice(0, 5).map(l => <MarketCard key={l.id} listing={l} onOpen={() => go('item', { listingId: l.id })} />)}</div>
            </section>
          )}

          {/* All Listings */}
          <section>
            <div className="flex items-center justify-center gap-4 mb-4">
              <span className="h-px flex-1" style={{ background: 'var(--eth-gold-dim)' }} />
              <h2 className="font-cinzel font-semibold text-xl tracking-wide" style={{ color: 'var(--eth-ink)' }}>All Listings</h2>
              <span className="text-sm" style={{ color: 'var(--eth-muted)' }}>{listings.length} items</span>
              <span className="h-px flex-1" style={{ background: 'var(--eth-gold-dim)' }} />
            </div>
            {loading ? <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[4/5] bg-white/[0.03] animate-pulse" />)}</div>
              : listings.length === 0 ? <div className="py-24 text-center" style={{ color: 'var(--eth-muted)' }}><Package className="w-12 h-12 mx-auto mb-3 opacity-40" />No items match your filters.</div>
              : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{listings.map(l => <MarketCard key={l.id} listing={l} onOpen={() => go('item', { listingId: l.id })} />)}</div>}
          </section>
        </div>
      </div>
    </div>
  )
}


function DigitalGoodCard({ good, requireAuth, onOpen, onBuy }) {
  const outOfStock = typeof good.stock === 'number' && good.stock <= 0
  // Rarity tiers are a Roblox-item concept (price-banded collectible scarcity) — they don't
  // mean anything for an account or toy code, so only toy codes (the one type this card was
  // originally built for) show a tier badge at all.
  const rarity = good.type === 'toycode' ? rarityFor(good) : null
  const accent = rarity ? rarity.color : 'var(--eth-gold-dim)'
  const buy = (e) => { e.stopPropagation(); if (outOfStock) return; requireAuth(() => onBuy ? onBuy() : toast.info('DM our Discord team with this item to complete your purchase.')) }
  return (
    <Card onClick={onOpen} className={`group relative overflow-hidden border transition-colors ${onOpen ? 'cursor-pointer' : ''}`}
      style={{ background: 'var(--eth-night1)', borderColor: 'var(--eth-gold-dim)' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--eth-gold)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--eth-gold-dim)' }}>
      {typeof good.stock === 'number' && <div className="absolute top-3 left-3 z-10 text-[10px] font-semibold tracking-wide px-2 py-1 rounded-md" style={{ background: 'rgba(10,6,20,0.75)', border: '1px solid var(--eth-gold-dim)', color: 'var(--eth-muted)' }}>{outOfStock ? 'OUT OF STOCK' : `${good.stock} LEFT`}</div>}
      <div className="p-4 pb-0">
        <div className="aspect-square overflow-hidden rounded-lg flex items-center justify-center" style={{ background: `radial-gradient(circle, ${accent}1a, transparent 70%)` }}>
          {good.imageUrl ? <img src={good.imageUrl} alt={good.title} className="w-full h-full object-cover rounded-lg group-hover:scale-[1.04] transition-transform duration-300" /> : <Ticket className="w-10 h-10" style={{ color: accent }} />}
        </div>
      </div>
      <div className="p-4 space-y-2.5">
        <div>
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--eth-ink)' }}>{good.title}</p>
          {rarity ? <p className="text-[10px] font-semibold tracking-widest mt-0.5" style={{ color: rarity.color }}>{rarity.label}</p>
            : good.description ? <p className="text-xs truncate mt-0.5" style={{ color: 'var(--eth-muted)' }}>{good.description}</p> : null}
        </div>
        {/* wrap, not nowrap: on a narrow 2-up mobile grid, price + button don't both fit on
            one line — nowrap let the button get clipped by this card's own overflow-hidden
            instead of wrapping to a second line. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-2.5 border-t" style={{ borderColor: 'rgba(107,33,168,0.25)' }}>
          <p className="text-lg font-bold" style={{ color: 'var(--eth-gold)' }}>{usd(good.price)}</p>
          <Button size="sm" disabled={outOfStock} onClick={buy} className="font-semibold h-8 rounded-lg border-0" style={{ background: 'linear-gradient(90deg, var(--eth-gold), var(--eth-lavender))', color: 'var(--eth-night1)' }}>{outOfStock ? 'Sold Out' : 'Buy Now'}</Button>
        </div>
      </div>
    </Card>
  )
}

function ToyCodeCheckoutDialog({ good, open, onClose, api, user }) {
  const router = useRouter()
  const [discordName, setDiscordName] = useState('')
  const [discordId, setDiscordId] = useState('')
  const [loading, setLoading] = useState('') // '' | 'crypto' | 'demo'
  const [done, setDone] = useState(null) // { orderCode } | { checkoutUrl } once the order is created

  const submit = async (demo) => {
    if (!discordName.trim()) { toast.error('Enter your Discord username'); return }
    if (!/^\d{15,25}$/.test(discordId.trim())) { toast.error('Enter a valid Discord ID (enable Developer Mode in Discord, then right-click your profile → Copy User ID)'); return }
    setLoading(demo ? 'demo' : 'crypto')
    try {
      const d = await api(`/toycodes/${good.id}/order`, { method: 'POST', body: JSON.stringify({ discordName: discordName.trim(), discordId: discordId.trim(), demo }) })
      if (d.checkoutUrl) { setDone({ checkoutUrl: d.checkoutUrl }); window.location.href = d.checkoutUrl }
      else { setDone({ orderCode: d.orderCode }); router.push(`/order/${d.orderCode}`) }
    } catch (e) { toast.error(e.message) } finally { setLoading('') }
  }

  const close = () => { setDone(null); setDiscordName(''); setDiscordId(''); onClose() }

  if (done) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
          <DialogHeader><DialogTitle className="text-xl font-black flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-400" /> Order placed</DialogTitle>
            <DialogDescription className="text-slate-400">{done.checkoutUrl ? "Taking you to checkout to complete payment." : "Taking you to your order page."}</DialogDescription></DialogHeader>
          <a href={done.checkoutUrl || `/order/${done.orderCode}`} className="block text-center w-full py-2.5 rounded-lg bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-bold text-white">
            {done.checkoutUrl ? 'Continue to checkout' : 'View my order'}
          </a>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
        <DialogHeader><DialogTitle className="text-xl font-black">Buy {good?.title}</DialogTitle>
          <DialogDescription className="text-slate-400">Delivered via Discord — we verify your Discord ID before delivering, so only you can claim this order.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-slate-300">Discord username</Label><Input className="bg-black/30 border-white/10 mt-1" value={discordName} onChange={e => setDiscordName(e.target.value)} placeholder="yourname" /></div>
          <div>
            <Label className="text-slate-300">Discord ID</Label>
            <Input className="bg-black/30 border-white/10 mt-1" value={discordId} onChange={e => setDiscordId(e.target.value)} placeholder="123456789012345678" />
            <p className="text-xs text-slate-500 mt-1">Enable Developer Mode in Discord (Settings → Advanced), then right-click your profile → Copy User ID.</p>
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={!!loading} onClick={() => submit(false)} className="w-full bg-gradient-to-r from-amber-500 to-orange-500 font-semibold">{loading === 'crypto' ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Bitcoin className="w-4 h-4 mr-2" /> Pay {usd(good?.price)} with Crypto</>}</Button>
          {user?.isAdmin && <Button disabled={!!loading} variant="outline" onClick={() => submit(true)} className="w-full border-white/10">{loading === 'demo' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Demo test purchase (skip payment, admin only)'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ToyCodesView({ api, go, requireAuth, user }) {
  const [goods, setGoods] = useState([])
  const [loading, setLoading] = useState(true)
  const [checkoutGood, setCheckoutGood] = useState(null)
  useEffect(() => { api('/toycodes').then(d => setGoods(d.toycodes || [])).catch(() => {}).finally(() => setLoading(false)) }, [api])
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="font-cinzel font-bold text-3xl mb-1 flex items-center gap-2.5 tracking-wide" style={{ color: 'var(--eth-ink)' }}><Ticket className="w-7 h-7" style={{ color: 'var(--eth-gold)' }} /> Toy Codes</h1>
      <p className="text-slate-400 mb-8">Redeemable codes for Roblox toys, delivered via Discord after purchase.</p>
      {loading ? <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[4/5] rounded-2xl bg-white/[0.03] animate-pulse" />)}</div>
        : goods.length === 0 ? <div className="py-24 text-center text-slate-400"><Ticket className="w-12 h-12 mx-auto mb-3 opacity-40" />No toy codes available right now. Check back soon.</div>
        : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{goods.map(g => <DigitalGoodCard key={g.id} good={g} requireAuth={requireAuth} onOpen={() => go('toycode', { id: g.id })} onBuy={() => setCheckoutGood(g)} />)}</div>}
      <ToyCodeCheckoutDialog good={checkoutGood} open={!!checkoutGood} onClose={() => setCheckoutGood(null)} api={api} user={user} />
    </div>
  )
}

function ToyCodeDetailView({ api, go, id, requireAuth, user }) {
  const [good, setGood] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  useEffect(() => {
    setLoading(true); setNotFound(false)
    api(`/toycodes/${id}`).then(d => setGood(d.toycode)).catch(() => setNotFound(true)).finally(() => setLoading(false))
  }, [api, id])

  if (loading) return <div className="container mx-auto px-4 py-8"><div className="max-w-3xl mx-auto animate-pulse space-y-4"><div className="aspect-video rounded-2xl bg-white/[0.03]" /><div className="h-6 w-1/2 bg-white/[0.03] rounded" /><div className="h-4 w-1/3 bg-white/[0.03] rounded" /></div></div>
  if (notFound || !good) return <div className="container mx-auto px-4 py-24 text-center text-slate-400"><Ticket className="w-12 h-12 mx-auto mb-3 opacity-40" />This toy code is no longer available.<div className="mt-4"><Button variant="outline" className="border-white/10" onClick={() => go('toycodes')}>Back to Toy Codes</Button></div></div>

  const outOfStock = typeof good.stock === 'number' && good.stock <= 0
  const buy = () => { if (outOfStock) return; requireAuth(() => setCheckoutOpen(true)) }

  return (
    <div className="container mx-auto px-4 py-8">
      <button onClick={() => go('toycodes')} className="flex items-center gap-1 text-sm text-slate-400 hover:text-white mb-6"><ChevronLeft className="w-4 h-4" /> Back to Toy Codes</button>
      <div className="max-w-3xl mx-auto grid md:grid-cols-2 gap-8">
        <div className="aspect-square overflow-hidden border-2 flex items-center justify-center" style={{ borderColor: rarityFor(good).color, background: `radial-gradient(circle, ${rarityFor(good).color}22, transparent 70%)` }}>
          {good.imageUrl ? <img src={good.imageUrl} alt={good.title} className="w-full h-full object-cover" /> : <Ticket className="w-16 h-16" style={{ color: rarityFor(good).color }} />}
        </div>
        <div>
          <p className="font-pixel text-[9px] tracking-widest mb-2" style={{ color: rarityFor(good).color }}>{rarityFor(good).label}</p>
          <h1 className="font-vt text-4xl mb-2" style={{ color: 'var(--eth-ink)' }}>{good.title}</h1>
          {typeof good.stock === 'number' && <Badge className={`mb-4 ${outOfStock ? 'bg-red-500/15 text-red-300 border-red-500/20' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'}`}>{outOfStock ? 'Out of stock' : `${good.stock} in stock`}</Badge>}
          <p className="text-slate-400 whitespace-pre-wrap mb-6">{good.description || 'No description provided.'}</p>
          <div className="flex items-center justify-between p-4 border-2" style={{ background: 'rgba(20,10,36,0.5)', borderColor: 'var(--eth-gold-dim)' }}>
            <p className="font-vt text-3xl" style={{ color: 'var(--eth-gold)' }}>{usd(good.price)}</p>
            <Button disabled={outOfStock} onClick={buy} className="rounded-none font-semibold" style={{ background: 'linear-gradient(90deg, var(--eth-teal), var(--eth-lavender))', color: 'var(--eth-night1)' }}>{outOfStock ? 'Sold Out' : 'Buy Now'}</Button>
          </div>
          <p className="text-xs text-slate-500 mt-3">Delivered via Discord using the <code className="px-1 bg-white/5 rounded">/claim</code> command after purchase.</p>
        </div>
      </div>
      <ToyCodeCheckoutDialog good={good} open={checkoutOpen} onClose={() => setCheckoutOpen(false)} api={api} user={user} />
    </div>
  )
}

const PROFILES_PAGE_SIZE = 12
function AccountsStoreView({ api, go, requireAuth }) {
  const [goods, setGoods] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  useEffect(() => { api('/accounts').then(d => setGoods(d.accounts || [])).catch(() => {}).finally(() => setLoading(false)) }, [api])
  const totalPages = Math.max(1, Math.ceil(goods.length / PROFILES_PAGE_SIZE))
  const pageClamped = Math.min(page, totalPages)
  const pageGoods = goods.slice((pageClamped - 1) * PROFILES_PAGE_SIZE, pageClamped * PROFILES_PAGE_SIZE)
  const goToPage = (p) => { setPage(Math.min(Math.max(1, p), totalPages)); window.scrollTo({ top: document.getElementById('profiles-grid')?.offsetTop - 100 || 0, behavior: 'smooth' }) }
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="font-cinzel font-bold text-3xl mb-1 flex items-center gap-2.5 tracking-wide" style={{ color: 'var(--eth-ink)' }}><User className="w-7 h-7" style={{ color: 'var(--eth-gold)' }} /> Profiles</h1>
      <p className="mb-8" style={{ color: 'var(--eth-muted)' }}>Roblox accounts for sale, delivered via Discord after purchase.</p>
      <div id="profiles-grid">
        {loading ? <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[4/5] rounded-xl bg-white/[0.03] animate-pulse" />)}</div>
          : goods.length === 0 ? <div className="py-24 text-center" style={{ color: 'var(--eth-muted)' }}><User className="w-12 h-12 mx-auto mb-3 opacity-40" />No profiles available right now. Check back soon.</div>
          : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{pageGoods.map(g => <DigitalGoodCard key={g.id} good={g} requireAuth={requireAuth} onOpen={go ? () => go('profile', { id: g.id }) : undefined} />)}</div>}
      </div>
      <Pager page={pageClamped} totalPages={totalPages} onPage={goToPage} />
    </div>
  )
}

function ProfileDetailView({ api, go, id, requireAuth }) {
  const [account, setAccount] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true); setNotFound(false)
    api(`/accounts/${id}`).then(d => setAccount(d.account)).catch(() => setNotFound(true)).finally(() => setLoading(false))
  }, [api, id])

  if (loading) return <div className="container mx-auto px-4 py-8"><div className="max-w-4xl mx-auto animate-pulse space-y-4"><div className="aspect-[3/1] rounded-2xl bg-white/[0.03]" /><div className="h-6 w-1/2 bg-white/[0.03] rounded" /><div className="h-4 w-1/3 bg-white/[0.03] rounded" /></div></div>
  if (notFound || !account) return <div className="container mx-auto px-4 py-24 text-center" style={{ color: 'var(--eth-muted)' }}><User className="w-12 h-12 mx-auto mb-3 opacity-40" />This profile is no longer available.<div className="mt-4"><Button variant="outline" className="border-white/10" onClick={() => go('profiles-store')}>Back to Profiles</Button></div></div>

  const { profile, limiteds = [], items = [], gamepasses = [] } = account
  const totalRap = limiteds.reduce((s, it) => s + (Number(it.rap) || 0), 0)
  const buy = () => requireAuth(() => toast.info('DM our Discord team with this profile to complete your purchase.'))

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <button onClick={() => go('profiles-store')} className="flex items-center gap-1 text-sm mb-6 transition-colors" style={{ color: 'var(--eth-muted)' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--eth-ink)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--eth-muted)'}><ChevronLeft className="w-4 h-4" /> Back to Profiles</button>

      <Card className="p-6 mb-6" style={{ background: 'var(--eth-night1)', borderColor: 'var(--eth-gold-dim)' }}>
        <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
          <img src={account.imageUrl} className="w-24 h-24 rounded-2xl object-cover shrink-0" style={{ background: 'rgba(107,33,168,0.15)' }} alt="" />
          <div className="flex-1 text-center sm:text-left min-w-0">
            <div className="flex items-center gap-2 justify-center sm:justify-start flex-wrap">
              <h1 className="text-2xl font-bold" style={{ color: 'var(--eth-ink)' }}>{account.title}</h1>
              {profile?.hasVerifiedBadge && <BadgeCheck className="w-5 h-5 text-blue-400" />}
            </div>
            {profile && <p className="text-sm mt-0.5" style={{ color: 'var(--eth-muted)' }}>@{profile.name} · ID {profile.id}</p>}
            {profile?.created && <p className="text-xs mt-1 flex items-center gap-1 justify-center sm:justify-start" style={{ color: 'var(--eth-muted)' }}><Calendar className="w-3 h-3" /> Joined {new Date(profile.created).toLocaleDateString()}</p>}
            {account.description && <p className="text-sm mt-3" style={{ color: 'var(--eth-muted)' }}>{account.description}</p>}
          </div>
          <div className="w-full sm:w-56 shrink-0 p-4 rounded-xl text-center" style={{ background: 'rgba(107,33,168,0.12)', border: '1px solid rgba(107,33,168,0.25)' }}>
            <p className="text-3xl font-bold" style={{ color: 'var(--eth-gold)' }}>{usd(account.price)}</p>
            <Button onClick={buy} className="w-full mt-3 font-semibold border-0" style={{ background: 'linear-gradient(90deg, var(--eth-gold), var(--eth-lavender))', color: 'var(--eth-night1)' }}>Buy Now</Button>
            <p className="text-[11px] mt-2" style={{ color: 'var(--eth-muted)' }}>Delivered via Discord after purchase</p>
          </div>
        </div>
        {profile && (
          <div className="flex flex-wrap gap-2.5 mt-5">
            <div className="flex-1 min-w-[110px] px-4 py-3 rounded-lg" style={{ background: 'rgba(107,33,168,0.12)', border: '1px solid rgba(107,33,168,0.25)' }}>
              <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--eth-muted)' }}>Total RAP</p>
              <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--eth-teal)' }}>{totalRap.toLocaleString()}</p>
            </div>
            <div className="flex-1 min-w-[110px] px-4 py-3 rounded-lg" style={{ background: 'rgba(107,33,168,0.12)', border: '1px solid rgba(107,33,168,0.25)' }}>
              <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--eth-muted)' }}>Limiteds</p>
              <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--eth-ink)' }}>{limiteds.length}</p>
            </div>
            <div className="flex-1 min-w-[110px] px-4 py-3 rounded-lg" style={{ background: 'rgba(107,33,168,0.12)', border: '1px solid rgba(107,33,168,0.25)' }}>
              <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--eth-muted)' }}>Items</p>
              <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--eth-ink)' }}>{items.length}</p>
            </div>
            <div className="flex-1 min-w-[110px] px-4 py-3 rounded-lg" style={{ background: 'rgba(107,33,168,0.12)', border: '1px solid rgba(107,33,168,0.25)' }}>
              <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--eth-muted)' }}>Game Passes</p>
              <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--eth-ink)' }}>{gamepasses.length}</p>
            </div>
          </div>
        )}
      </Card>

      <ProfileInventoryTabs limiteds={limiteds} items={items} gamepasses={gamepasses} />
    </div>
  )
}

function StatusRow({ ok, title, desc, children }) {
  const good = ok === true
  const Icon = good ? CheckCircle2 : AlertTriangle
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${good ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${good ? 'text-emerald-400' : 'text-amber-400'}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${good ? 'text-emerald-300' : 'text-amber-300'}`}>{title}</p>
        {desc && <p className="text-xs text-slate-400 mt-0.5">{desc}</p>}
        {children}
      </div>
    </div>
  )
}

function ItemView({ api, go, listingId, user, requireAuth, cfg }) {
  const [data, setData] = useState(null)
  const [buying, setBuying] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [related, setRelated] = useState([])
  const [info, setInfo] = useState({ discordName: '', discordTag: '', robloxUsername: '' })
  // Checkout wizard: 'form' -> 'confirm' -> 'checks'
  const [step, setStep] = useState('form')
  const [rbxProfile, setRbxProfile] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [elig, setElig] = useState(null)
  const [checking, setChecking] = useState(false)
  const [giveItems, setGiveItems] = useState([]) // assetIds the buyer picks to give
  useEffect(() => {
    api(`/listings/${listingId}`).then(d => { setData(d); api(`/listings?category=${encodeURIComponent(d.listing.item.category)}`).then(r => setRelated((r.listings || []).filter(x => x.id !== listingId).slice(0, 4))) }).catch(e => toast.error(e.message))
  }, [api, listingId])

  const resetCheckout = () => { setStep('form'); setRbxProfile(null); setElig(null); setGiveItems([]); setVerifying(false); setChecking(false) }
  const openCheckout = () => { resetCheckout(); setConfirmOpen(true) }

  // Step 1 -> 2: look up the Roblox account so the buyer can confirm it's theirs
  const verifyAccount = async () => {
    if (!info.discordName.trim() || !info.robloxUsername.trim()) { toast.error('Please fill in your Discord and Roblox username.'); return }
    setVerifying(true)
    try {
      const d = await api(`/profile/lookup?input=${encodeURIComponent(info.robloxUsername.trim())}`)
      setRbxProfile(d.profile)
      setStep('confirm')
    } catch (e) { toast.error('Could not find that Roblox account. Check the username.') } finally { setVerifying(false) }
  }

  // Step 2 -> 3: buyer confirmed the account, now run eligibility checks
  const confirmAccount = async () => {
    if (!rbxProfile) return
    setStep('checks'); setChecking(true); setElig(null)
    try {
      const d = await api(`/checkout/eligibility?userId=${rbxProfile.id}`)
      setElig(d.eligibility)
    } catch (e) { toast.error(e.message || 'Eligibility check failed') } finally { setChecking(false) }
  }
  const toggleGive = (assetId) => setGiveItems(prev => prev.includes(assetId) ? prev.filter(x => x !== assetId) : [...prev, assetId])

  const buy = async () => {
    if (!info.discordName.trim() || !info.robloxUsername.trim()) { toast.error('Please fill in your Discord and Roblox username.'); return }
    setBuying(true)
    try {
      const chosen = (elig?.limiteds || []).filter(l => giveItems.includes(l.assetId)).map(l => ({ assetId: l.assetId, name: l.name, rap: l.rap }))
      const d = await api('/orders', { method: 'POST', body: JSON.stringify({ listingId, discordName: info.discordName.trim(), discordTag: info.discordTag.trim(), robloxUsername: info.robloxUsername.trim(), robloxUserId: rbxProfile?.id || null, giveItems: chosen }) })
      if (d.checkoutUrl) { toast.success('Redirecting to secure crypto checkout...'); window.location.assign(d.checkoutUrl) }
      else { setConfirmOpen(false); go('order', { orderId: d.orderId }) } // demo mode (no token yet)
    } catch (e) { toast.error(e.message) } finally { setBuying(false) }
  }
  const submitReport = async (reason) => { try { await api('/reports', { method: 'POST', body: JSON.stringify({ listingId, reason }) }); toast.success('Report submitted. Thanks!'); setReportOpen(false) } catch (e) { toast.error(e.message) } }
  const toggleWish = () => requireAuth(async () => { try { const d = await api('/wishlist', { method: 'POST', body: JSON.stringify({ itemId: data.listing.itemId }) }); toast.success(d.added ? 'Added to wishlist' : 'Removed from wishlist') } catch (e) { toast.error(e.message) } })

  if (!data) return <div className="container mx-auto px-4 py-32 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-[#c084fc]" /></div>
  const { listing, seller } = data
  const sold = listing.status !== 'active'
  return (
    <div className="container mx-auto px-4 py-8">
      <Button variant="ghost" className="mb-6 text-slate-400" onClick={() => go('browse')}><ChevronLeft className="w-4 h-4 mr-1" /> Back to marketplace</Button>
      <div className="grid md:grid-cols-2 gap-8">
        <div className="relative overflow-hidden border-2" style={{ borderColor: rarityFor(listing).color, background: 'rgba(0,0,0,0.4)' }}>
          <img src={listing.item.imageUrl} alt={listing.item.name} className="w-full aspect-square object-cover" />
          <Badge className="absolute top-4 left-4 bg-black/70 text-[#c084fc] border-[#c084fc]/40">{listing.item.category}</Badge>
          {sold && <div className="absolute inset-0 bg-black/70 flex items-center justify-center"><Badge className="bg-red-500/90 text-white text-lg px-6 py-2">SOLD</Badge></div>}
        </div>
        <div className="space-y-5">
          <div>
            <p className="font-pixel text-[9px] tracking-widest mb-2" style={{ color: rarityFor(listing).color }}>{rarityFor(listing).label}</p>
            <div className="flex items-start justify-between gap-4">
              <h1 className="font-vt text-4xl" style={{ color: 'var(--eth-ink)' }}>{listing.item.name}</h1>
              <Button size="icon" variant="ghost" className="text-slate-400 hover:text-[#f472b6]" onClick={toggleWish}><Heart className="w-5 h-5" /></Button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">{listing.condition}</Badge>
              <span className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Expires {new Date(listing.expiresAt).toLocaleDateString()}</span>
              <span className="text-xs text-slate-500 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {listing.popularity} views</span>
            </div>
          </div>
          <p className="text-slate-400">{listing.item.description}</p>
          <Card className="p-5 rounded-none border-2" style={{ background: 'rgba(20,10,36,0.5)', borderColor: 'var(--eth-gold-dim)' }}>
            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <div className="py-2 border" style={{ background: 'rgba(0,0,0,0.3)', borderColor: 'rgba(255,255,255,0.06)' }}><p className="text-[10px] uppercase tracking-widest text-slate-500">RAP</p><p className="font-vt text-lg" style={{ color: 'var(--eth-teal)' }}>{listing.rap != null ? Number(listing.rap).toLocaleString() : '—'}</p></div>
              <div className="py-2 border" style={{ background: 'rgba(0,0,0,0.3)', borderColor: 'rgba(255,255,255,0.06)' }}><p className="text-[10px] uppercase tracking-widest text-slate-500">Robux</p><p className="font-vt text-lg text-slate-300">{listing.robuxPrice != null ? Number(listing.robuxPrice).toLocaleString() : '—'}</p></div>
              <div className="py-2 border" style={{ background: 'rgba(0,0,0,0.3)', borderColor: 'rgba(255,255,255,0.06)' }}><p className="text-[10px] uppercase tracking-widest text-slate-500">Stock</p><p className="font-vt text-lg" style={{ color: 'var(--eth-gold)' }}>{typeof listing.stock === 'number' ? listing.stock : '—'}</p></div>
            </div>
            <div className="flex items-end justify-between mb-4">
              <PriceTag price={listing.price} size="lg" />
              <div className="text-right text-xs text-slate-500">Roblox Asset ID<br /><span className="text-slate-300 font-mono">{listing.robloxAssetId || listing.item.robloxItemId || 'N/A'}</span></div>
            </div>
            {sold ? <Button disabled className="w-full" variant="secondary">Sold out</Button>
              : <Button onClick={() => requireAuth(openCheckout)} className="w-full h-12 text-base rounded-none bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 font-bold"><Bitcoin className="w-5 h-5 mr-2" /> Buy with Crypto</Button>}
            <p className="text-xs text-slate-500 mt-2 text-center flex items-center justify-center gap-1"><Shield className="w-3 h-3" /> Secure crypto checkout {cfg?.receiveCurrency ? `· settles in ${cfg.receiveCurrency}` : ''}</p>
          </Card>
          <button onClick={() => go('seller', { username: listing.sellerName })} className="w-full flex items-center gap-3 p-4 border transition-colors text-left" style={{ background: 'rgba(20,10,36,0.5)', borderColor: 'var(--eth-gold-dim)' }}>
            <img src={listing.sellerAvatar} className="w-12 h-12 rounded-full bg-white/10" alt="" />
            <div className="flex-1"><div className="flex items-center gap-2"><p className="font-bold">{listing.sellerName}</p><CheckCircle2 className="w-4 h-4 text-emerald-400" /></div>
              <div className="flex items-center gap-3 text-xs text-slate-400"><span className="flex items-center gap-1"><Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {(listing.sellerRep || 5).toFixed(1)} rating</span><span>{seller?.salesCount || 0} sales</span></div></div>
            <span className="text-[#c084fc] text-sm">View store</span>
          </button>
          <button onClick={() => requireAuth(() => setReportOpen(true))} className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1"><Flag className="w-3 h-3" /> Report this listing</button>
        </div>
      </div>

      {related.length > 0 && <div className="mt-16"><h2 className="font-cinzel font-semibold text-xl tracking-wide mb-5" style={{ color: 'var(--eth-ink)' }}>More in {listing.item.category}</h2><div className="grid grid-cols-2 sm:grid-cols-4 gap-4">{related.map(l => <ItemCard key={l.id} listing={l} onOpen={() => go('item', { listingId: l.id })} />)}</div></div>}

      <Dialog open={confirmOpen} onOpenChange={(o) => { setConfirmOpen(o); if (!o) resetCheckout() }}>
        <DialogContent className="bg-[#12101f] border-white/10 text-slate-100 max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bitcoin className="w-5 h-5 text-amber-400" /> Checkout with Crypto</DialogTitle>
            <DialogDescription className="text-slate-400">
              {step === 'form' && "Enter your details so we can deliver your item."}
              {step === 'confirm' && "Is this the Roblox account you'll receive the item on?"}
              {step === 'checks' && "We ran a few quick checks on your Roblox account."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-black/30">
            <img src={listing.item.imageUrl} className="w-16 h-16 rounded-lg object-cover" alt="" />
            <div className="flex-1"><p className="font-bold">{listing.item.name}</p><p className="text-xs text-slate-400">from {listing.sellerName}</p></div>
            <PriceTag price={listing.price} />
          </div>

          {/* STEP 1: contact + roblox username */}
          {step === 'form' && (
            <>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Label className="text-xs text-slate-400">Discord username</Label>
                    <Input value={info.discordName} onChange={e => setInfo({ ...info, discordName: e.target.value })} placeholder="yourname" className="bg-black/30 border-white/10 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400"># (optional)</Label>
                    <Input value={info.discordTag} onChange={e => setInfo({ ...info, discordTag: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })} placeholder="0000" className="bg-black/30 border-white/10 mt-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-slate-400">Roblox username</Label>
                  <Input value={info.robloxUsername} onChange={e => setInfo({ ...info, robloxUsername: e.target.value })} placeholder="RobloxUser123" className="bg-black/30 border-white/10 mt-1" onKeyDown={e => { if (e.key === 'Enter') verifyAccount() }} />
                  <p className="text-[11px] text-slate-500 mt-1">We'll look this up so you can confirm it's your account.</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                <Button disabled={verifying} onClick={verifyAccount} className="bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-bold">{verifying ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Looking up...</> : 'Verify Roblox account'}</Button>
              </DialogFooter>
            </>
          )}

          {/* STEP 2: confirm account */}
          {step === 'confirm' && rbxProfile && (
            <>
              <div className="flex flex-col items-center text-center py-2">
                <img src={rbxProfile.headshotUrl || rbxProfile.avatarUrl} className="w-24 h-24 rounded-full bg-black/40 border border-white/10" alt="" />
                <div className="flex items-center gap-1.5 mt-3">
                  <p className="text-lg font-black">{rbxProfile.displayName}</p>
                  {rbxProfile.hasVerifiedBadge && <BadgeCheck className="w-4 h-4 text-sky-400" />}
                </div>
                <p className="text-sm text-slate-400">@{rbxProfile.name}</p>
                <a href={`https://www.roblox.com/users/${rbxProfile.id}/profile`} target="_blank" rel="noreferrer" className="text-xs text-[#c084fc] hover:underline mt-1 flex items-center gap-1">View profile <ExternalLink className="w-3 h-3" /></a>
              </div>
              <DialogFooter className="sm:justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep('form')}>No, re-enter</Button>
                <Button onClick={confirmAccount} className="bg-gradient-to-r from-emerald-500 to-teal-600 font-bold"><CheckCircle2 className="w-4 h-4 mr-2" /> Yes, this is my account</Button>
              </DialogFooter>
            </>
          )}

          {/* STEP 3: eligibility checks */}
          {step === 'checks' && (
            <>
              {checking || !elig ? (
                <div className="py-10 flex flex-col items-center text-slate-400"><Loader2 className="w-7 h-7 animate-spin text-[#c084fc] mb-3" /> Checking your Roblox account...</div>
              ) : (
                <div className="space-y-2.5">
                  {/* Premium */}
                  {elig.premiumChecked
                    ? <StatusRow ok={elig.premium} title={elig.premium ? 'Roblox Premium active' : 'No Roblox Premium detected'} desc={elig.premium ? "You have the Premium (Roblox+) mark." : 'Trading limiteds requires Roblox Premium. You can still continue, but delivery may not be possible without it.'} />
                    : <StatusRow ok={false} title="Couldn't verify Premium" desc="We couldn't confirm Premium right now. Make sure you have Roblox Premium so the item can be traded to you." />}
                  {/* Trades — live check via trade-eligible bot; guidance when unverifiable */}
                  {elig.tradesChecked
                    ? <StatusRow ok={elig.tradesEnabled} title={elig.tradesEnabled ? 'Trades are enabled' : 'Trades appear to be disabled'} desc={elig.tradesEnabled ? 'Your account can receive trades.' : 'We were unable to trade with your account. Turn trading on so we can deliver your item.'}>
                        {!elig.tradesEnabled && <a href="https://www.roblox.com/my/account#!/privacy" target="_blank" rel="noreferrer" className="text-xs text-amber-300 hover:underline mt-1 inline-flex items-center gap-1">Roblox → Settings → Privacy → “Who can trade with me” → set to Everyone <ExternalLink className="w-3 h-3" /></a>}
                      </StatusRow>
                    : <StatusRow ok={false} title="Make sure trades are enabled" desc="Trades must be turned on so we can deliver your item.">
                        <a href="https://www.roblox.com/my/account#!/privacy" target="_blank" rel="noreferrer" className="text-xs text-amber-300 hover:underline mt-1 inline-flex items-center gap-1">Roblox → Settings → Privacy → “Who can trade with me” → set to Everyone <ExternalLink className="w-3 h-3" /></a>
                      </StatusRow>}
                  {/* Inventory */}
                  {elig.inventoryChecked
                    ? <StatusRow ok={elig.inventoryPublic} title={elig.inventoryPublic ? 'Inventory is public' : 'Inventory is private'} desc={elig.inventoryPublic ? 'We can verify your items.' : 'Set your inventory to public so we can verify and deliver items.'}>
                        {!elig.inventoryPublic && <a href="https://www.roblox.com/my/account#!/privacy" target="_blank" rel="noreferrer" className="text-xs text-amber-300 hover:underline mt-1 inline-flex items-center gap-1">Settings → Privacy → “Who can see my inventory” → Everyone <ExternalLink className="w-3 h-3" /></a>}
                      </StatusRow>
                    : <StatusRow ok={false} title="Couldn't check inventory visibility" />}

                  {/* Limiteds selection */}
                  <div className="pt-1">
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs text-slate-300 font-semibold">Choose the item(s) you'll give</Label>
                      <span className="text-[11px] text-slate-500">Each must be under {Number(elig.rapLimit).toLocaleString()} RAP</span>
                    </div>
                    {elig.limiteds.length === 0 ? (
                      <p className="text-xs text-slate-500 p-3 rounded-lg bg-black/30 border border-[#6b21a8]/40">No limiteds found on this account{elig.inventoryPublic === false ? ' (inventory is private)' : ''}.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                        {elig.limiteds.map(l => {
                          const over = (l.rap ?? 0) >= elig.rapLimit
                          const sel = giveItems.includes(l.assetId)
                          return (
                            <button key={l.assetId} onClick={() => toggleGive(l.assetId)} className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-colors ${sel ? 'border-[#c084fc] bg-[#c084fc]/10' : 'border-white/10 bg-black/30 hover:border-white/20'}`}>
                              <img src={l.imageUrl} className="w-10 h-10 rounded-md object-cover bg-black/40 shrink-0" alt="" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{l.name}</p>
                                <p className={`text-[11px] flex items-center gap-1 ${over ? 'text-amber-400' : 'text-slate-400'}`}>RAP {l.rap != null ? Number(l.rap).toLocaleString() : '—'}{over && <span className="inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> over {Number(elig.rapLimit / 1000)}k</span>}</p>
                              </div>
                              {sel && <CheckCircle2 className="w-4 h-4 text-[#c084fc] shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {giveItems.some(id => { const it = elig.limiteds.find(l => l.assetId === id); return it && (it.rap ?? 0) >= elig.rapLimit }) && (
                      <p className="text-[11px] text-amber-300 mt-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> One or more selected items are over {Number(elig.rapLimit).toLocaleString()} RAP.</p>
                    )}
                  </div>

                  {!cfg?.cryptoConfigured && <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">Demo mode: live crypto isn't configured yet, so this will simulate a confirmed payment.</p>}
                  <p className="text-[11px] text-slate-500 text-center">Warnings won't block your purchase — you can still continue to payment.</p>
                </div>
              )}
              <DialogFooter className="sm:justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep('confirm')}>Back</Button>
                <Button disabled={buying || checking} onClick={buy} className="bg-gradient-to-r from-amber-500 to-orange-500 font-bold">{buying ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Starting...</> : 'Continue to Payment'}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
          <DialogHeader><DialogTitle>Report Listing</DialogTitle></DialogHeader>
          <div className="space-y-2">{['Fraudulent / scam', 'Wrong or misleading item', 'Inappropriate content', 'Price manipulation'].map(r => <button key={r} onClick={() => submitReport(r)} className="w-full text-left p-3 rounded-lg bg-black/30 hover:bg-white/5 border border-[#6b21a8]/40 text-sm">{r}</button>)}</div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function OrderStatusView({ api, go, orderId, refreshNotifs, cfg }) {
  const [order, setOrder] = useState(null)
  const [simulating, setSimulating] = useState(false)
  const load = useCallback(async () => { try { const d = await api(`/payments/status?orderId=${orderId}`); setOrder(d) } catch (e) { toast.error(e.message) } }, [api, orderId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!order || order.status === 'paid') return
    const t = setInterval(async () => { const d = await api(`/payments/status?orderId=${orderId}`).catch(() => null); if (d) { setOrder(d); if (d.status === 'paid') { clearInterval(t); refreshNotifs() } } }, 4000)
    return () => clearInterval(t)
  }, [order, api, orderId, refreshNotifs])

  const simulate = async () => { setSimulating(true); try { await api('/payments/simulate', { method: 'POST', body: JSON.stringify({ orderId }) }); await load(); refreshNotifs(); toast.success('Payment confirmed!') } catch (e) { toast.error(e.message) } finally { setSimulating(false) } }

  if (!order) return <div className="container mx-auto px-4 py-32 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-[#c084fc]" /></div>
  const paid = order.status === 'paid'
  const pending = order.status === 'pending_payment'
  return (
    <div className="container mx-auto px-4 py-16 max-w-lg text-center">
      <Card className="p-8 bg-[#140a24]/60 border-[#6b21a8]/40 rounded-none">
        {order.item?.imageUrl && <img src={order.item.imageUrl} className="w-24 h-24 rounded-xl object-cover mx-auto mb-4" alt="" />}
        {paid ? (
          <><div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-9 h-9 text-emerald-400" /></div>
            <h1 className="text-2xl font-black mb-1">Payment Confirmed!</h1><p className="text-slate-400 mb-6">You now own <span className="text-white font-semibold">{order.item?.name}</span>.</p>
            <Button onClick={() => go('dashboard')} className="bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">View my purchases</Button></>
        ) : pending ? (
          <><Loader2 className="w-12 h-12 animate-spin text-amber-400 mx-auto mb-4" /><h1 className="text-2xl font-black mb-1">Awaiting Payment</h1>
            <p className="text-slate-400 mb-6">We're waiting for your crypto payment to be confirmed on-chain. This can take a few minutes.</p>
            <div className="flex flex-col gap-2">
              {order.checkoutUrl && <Button onClick={() => window.location.assign(order.checkoutUrl)} className="bg-gradient-to-r from-amber-500 to-orange-500 font-semibold"><Bitcoin className="w-4 h-4 mr-2" /> Open crypto checkout</Button>}
              <Button onClick={load} variant="outline" className="border-white/10">Refresh status</Button>
              {!cfg?.cryptoConfigured && <Button onClick={simulate} disabled={simulating} className="bg-gradient-to-r from-amber-500 to-orange-500 font-semibold">{simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simulate confirmed payment (demo)'}</Button>}
            </div></>
        ) : (
          <><div className="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4"><Package className="w-8 h-8 text-red-400" /></div>
            <h1 className="text-2xl font-black mb-1">Payment {order.status}</h1><p className="text-slate-400 mb-6">This order did not complete. You can try again.</p>
            <Button onClick={() => go('browse')} className="bg-gradient-to-r from-[#c084fc] to-[#f472b6]">Back to marketplace</Button></>
        )}
      </Card>
    </div>
  )
}

function SellerView({ api, go, name }) {
  const [data, setData] = useState(null)
  useEffect(() => { api(`/users/${encodeURIComponent(name)}`).then(setData).catch(e => toast.error(e.message)) }, [api, name])
  if (!data) return <div className="container mx-auto px-4 py-32 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-[#c084fc]" /></div>
  const { user, listings } = data
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="rounded-2xl overflow-hidden border border-[#6b21a8]/40 mb-8">
        <div className="h-32 bg-gradient-to-r from-[#c084fc]/40 via-[#f472b6]/30 to-[#f472b6]/40" />
        <div className="px-6 pb-6 -mt-12 flex flex-col sm:flex-row sm:items-end gap-4 bg-[#140a24]/60">
          <img src={user.avatarUrl} className="w-24 h-24 rounded-2xl border-4 border-[#0a0912] bg-white/10" alt="" />
          <div className="flex-1"><div className="flex items-center gap-2"><h1 className="text-2xl font-black">{user.name}</h1><Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30"><CheckCircle2 className="w-3 h-3 mr-1" /> Verified store</Badge></div>
            <div className="flex items-center gap-4 text-sm text-slate-400 mt-1"><span className="flex items-center gap-1"><Star className="w-4 h-4 fill-amber-400 text-amber-400" /> {(user.reputation || 5).toFixed(1)} rating</span><span>{user.salesCount || 0} sales</span></div></div>
        </div>
      </div>
      <h2 className="text-xl font-black mb-5">Active Listings ({listings.length})</h2>
      {listings.length === 0 ? <p className="text-slate-400 py-12 text-center">No active listings.</p> : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">{listings.map(l => <ItemCard key={l.id} listing={l} onOpen={() => go('item', { listingId: l.id })} />)}</div>}
    </div>
  )
}

function SellersView({ api, go }) {
  const [vendors, setVendors] = useState([])
  useEffect(() => { api('/vendors').then(d => setVendors(d.vendors || [])).catch(() => {}) }, [api])
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-black mb-6 flex items-center gap-2"><Store className="w-7 h-7 text-[#c084fc]" /> Verified Stores</h1>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {vendors.map(s => (
          <button key={s.id} onClick={() => go('seller', { username: s.name })} className="flex items-center gap-4 p-5 rounded-2xl bg-[#140a24]/60 border border-[#6b21a8]/40 hover:border-[#c084fc]/40 transition-all hover:-translate-y-1 text-left">
            <img src={s.avatarUrl} className="w-16 h-16 rounded-2xl bg-white/10" alt="" />
            <div><p className="font-bold text-lg">{s.name}</p><p className="text-sm text-slate-400 flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> {(s.reputation || 5).toFixed(1)} · {s.salesCount || 0} sales</p></div>
          </button>
        ))}
      </div>
    </div>
  )
}

function Empty({ text }) { return <div className="py-16 text-center text-slate-400"><Package className="w-10 h-10 mx-auto mb-3 opacity-40" />{text}</div> }

function ProfilesView({ api, embedded = false }) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [profile, setProfile] = useState(null)
  const [limiteds, setLimiteds] = useState(null)
  const [items, setItems] = useState(null)
  const [gp, setGp] = useState(null)
  const [rapHist, setRapHist] = useState(null)

  const lookup = async () => {
    if (!input.trim()) { toast.error('Enter a Roblox username, ID, or profile link'); return }
    setLoading(true); setProfile(null); setLimiteds(null); setItems(null); setGp(null); setRapHist(null)
    try {
      const d = await api(`/profile/lookup?input=${encodeURIComponent(input.trim())}`)
      setProfile(d.profile)
      const uid = d.profile.id
      api(`/profile/${uid}/limiteds`).then(r => setLimiteds(r)).catch(() => setLimiteds({ limiteds: [], private: true }))
      api(`/profile/${uid}/items`).then(r => setItems(r)).catch(() => setItems({ items: [], private: true }))
      api(`/profile/${uid}/gamepasses`).then(r => setGp(r)).catch(() => setGp({ passes: [] }))
      api(`/profile/${uid}/rap-history`).then(r => setRapHist(r)).catch(() => setRapHist({ totalRap: 0, history: [] }))
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }

  const monthLabel = (m) => { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) }

  return (
    <div className={embedded ? '' : 'container mx-auto px-4 py-8 max-w-5xl'}>
      {!embedded && <h1 className="text-3xl font-black mb-2 flex items-center gap-2"><User className="w-7 h-7 text-[#c084fc]" /> Roblox Profiles</h1>}
      <p className="text-slate-400 mb-5">Paste a Roblox profile link, username, or user ID to view their limiteds, items, game passes & account info.</p>
      <div className="flex gap-2 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && lookup()} placeholder="https://www.roblox.com/users/156/profile  ·  builderman  ·  156" className="pl-12 h-12 bg-[#0e0d16] border-white/10 rounded-xl" />
        </div>
        <Button onClick={lookup} disabled={loading} className="h-12 px-8 bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-bold rounded-xl">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Detect'}</Button>
      </div>

      {profile && (
        <div>
          {/* Header */}
          <Card className="p-6 bg-[#140a24]/60 border-[#6b21a8]/40 mb-6 flex flex-col sm:flex-row gap-5 items-center sm:items-start">
            <img src={profile.avatarUrl || profile.headshotUrl} className="w-28 h-28 rounded-2xl bg-white/5 object-cover" alt="" />
            <div className="flex-1 text-center sm:text-left">
              <div className="flex items-center gap-2 justify-center sm:justify-start">
                <h2 className="text-2xl font-black">{profile.displayName}</h2>
                {profile.hasVerifiedBadge && <BadgeCheck className="w-5 h-5 text-blue-400" />}
                {profile.isBanned && <Badge className="bg-red-500/20 text-red-300 border-red-500/30">Banned</Badge>}
              </div>
              <p className="text-slate-400">@{profile.name} · ID {profile.id}</p>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1 justify-center sm:justify-start"><Calendar className="w-3 h-3" /> Joined {new Date(profile.created).toLocaleDateString()}</p>
              {profile.description && <p className="text-sm text-slate-300 mt-3 max-w-2xl whitespace-pre-line">{profile.description}</p>}
            </div>
          </Card>

          <Tabs defaultValue="items">
            <TabsList className="bg-[#140a24] border border-[#6b21a8]/40 rounded-none">
              <TabsTrigger value="items"><Gem className="w-4 h-4 mr-1" /> Items</TabsTrigger>
              <TabsTrigger value="gamepasses"><Gamepad2 className="w-4 h-4 mr-1" /> Game Passes</TabsTrigger>
              <TabsTrigger value="info"><Info className="w-4 h-4 mr-1" /> Account Info</TabsTrigger>
            </TabsList>

            <TabsContent value="items" className="mt-5">
              <Tabs defaultValue="limiteds">
                <TabsList className="bg-black/30 border border-[#6b21a8]/40">
                  <TabsTrigger value="limiteds">Limiteds {limiteds?.limiteds ? `(${limiteds.limiteds.length})` : ''}</TabsTrigger>
                  <TabsTrigger value="regular">Regular {items?.items ? `(${items.items.length})` : ''}</TabsTrigger>
                </TabsList>
                <TabsContent value="limiteds" className="mt-4">
                  {!limiteds ? <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#c084fc]" /></div>
                    : limiteds.limiteds.length === 0 ? <Empty text={limiteds.private ? 'This account has no public limiteds (or inventory is private).' : 'No limiteds found.'} />
                    : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                        {limiteds.limiteds.map(it => (
                          <Card key={it.assetId} className="overflow-hidden bg-[#0e0d16] border-[#6b21a8]/40">
                            <div className="aspect-square bg-white/[0.03]"><img src={it.imageUrl} className="w-full h-full object-cover" alt="" /></div>
                            <div className="p-3"><p className="text-sm font-semibold truncate">{it.name}</p>
                              <div className="flex justify-between items-center mt-1"><span className="text-[10px] uppercase text-slate-500">RAP</span><span className="text-sm font-bold text-emerald-400">{it.rap != null ? Number(it.rap).toLocaleString() : '—'}</span></div>
                              {it.serialNumber && <p className="text-[10px] text-[#c084fc] mt-0.5">#{it.serialNumber}</p>}
                            </div>
                          </Card>
                        ))}
                      </div>}
                </TabsContent>
                <TabsContent value="regular" className="mt-4">
                  {!items ? <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#c084fc]" /></div>
                    : items.items.length === 0 ? <Empty text="No public regular items (or inventory is private)." />
                    : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                        {items.items.map(it => (
                          <Card key={it.assetId} className="overflow-hidden bg-[#0e0d16] border-[#6b21a8]/40">
                            <div className="aspect-square bg-white/[0.03]"><img src={it.imageUrl} className="w-full h-full object-cover" alt="" /></div>
                            <div className="p-2"><p className="text-xs font-semibold truncate">{it.name}</p><p className="text-[10px] text-slate-500">{it.category}</p></div>
                          </Card>
                        ))}
                      </div>}
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="gamepasses" className="mt-5">
              {!gp ? <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#c084fc]" /></div>
                : (gp.passes || []).length === 0 ? <Empty text="No public game passes found for this account." />
                : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {gp.passes.map(p => (
                      <Card key={p.id} className="p-3 bg-[#0e0d16] border-[#6b21a8]/40 flex items-center gap-3">
                        <img src={p.imageUrl} className="w-12 h-12 rounded-lg object-cover bg-white/5" alt="" />
                        <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{p.name}</p><p className="text-xs text-slate-500 truncate">{p.universe}</p></div>
                        <span className="text-sm font-bold text-emerald-400 shrink-0">{p.price != null ? `${p.price} R$` : 'Free'}</span>
                      </Card>
                    ))}
                  </div>}
            </TabsContent>

            <TabsContent value="info" className="mt-5">
              {(() => {
                const localTotal = limiteds?.limiteds ? limiteds.limiteds.reduce((s, it) => s + (Number(it.rap) || 0), 0) : 0
                const totalRap = (rapHist && rapHist.totalRap) ? rapHist.totalRap : localTotal
                const limCount = limiteds?.limiteds ? limiteds.limiteds.length : (rapHist?.count || 0)
                const hist = rapHist?.history || []
                const first = hist.length ? hist[0].rap : null
                const last = hist.length ? hist[hist.length - 1].rap : null
                const delta = (first != null && last != null && first > 0) ? ((last - first) / first) * 100 : null
                return (
                  <div className="space-y-6">
                    {/* Headline stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <Card className="p-5 bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20">
                        <p className="text-[11px] uppercase tracking-widest text-emerald-300/70 font-bold flex items-center gap-1"><Coins className="w-3.5 h-3.5" /> Total RAP</p>
                        <p className="text-3xl font-black text-emerald-400 mt-1">{totalRap.toLocaleString()}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">across {limCount} limited{limCount === 1 ? '' : 's'}</p>
                      </Card>
                      <Card className="p-5 bg-[#140a24]/60 border-[#6b21a8]/40 rounded-none">
                        <p className="text-[11px] uppercase tracking-widest text-slate-400 font-bold flex items-center gap-1"><Gem className="w-3.5 h-3.5" /> Limiteds</p>
                        <p className="text-3xl font-black text-[#c084fc] mt-1">{limCount.toLocaleString()}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">collectible items held</p>
                      </Card>
                      <Card className="p-5 bg-[#140a24]/60 border-[#6b21a8]/40 rounded-none">
                        <p className="text-[11px] uppercase tracking-widest text-slate-400 font-bold flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> 12-mo Trend</p>
                        <p className={`text-3xl font-black mt-1 ${delta == null ? 'text-slate-400' : delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">total RAP change</p>
                      </Card>
                    </div>

                    {/* RAP history graph */}
                    <Card className="p-5 bg-[#140a24]/60 border-[#6b21a8]/40 rounded-none">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p className="font-bold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" /> Total RAP History</p>
                          <p className="text-xs text-slate-500">Account value over the last 12 months{rapHist?.tracked ? ` · tracking top ${rapHist.tracked} holdings` : ''}</p>
                        </div>
                      </div>
                      {!rapHist ? <div className="h-64 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
                        : hist.length === 0 ? <div className="h-64"><Empty text="No RAP history available for this account." /></div>
                        : (
                          <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={hist.map(h => ({ ...h, label: monthLabel(h.month) }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="rapFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={55} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                                <RTooltip
                                  contentStyle={{ background: '#12101f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#e2e8f0' }}
                                  labelStyle={{ color: '#94a3b8' }}
                                  formatter={(v) => [`${Number(v).toLocaleString()} RAP`, 'Total RAP']}
                                />
                                <Area type="monotone" dataKey="rap" stroke="#10b981" strokeWidth={2.5} fill="url(#rapFill)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                    </Card>

                    <Card className="p-6 bg-[#140a24]/60 border-[#6b21a8]/40 max-w-2xl">
                      {[['User ID', profile.id], ['Username', '@' + profile.name], ['Display Name', profile.displayName], ['Account Created', new Date(profile.created).toLocaleString()], ['Verified Badge', profile.hasVerifiedBadge ? 'Yes' : 'No'], ['Banned', profile.isBanned ? 'Yes' : 'No']].map(([k, v]) => (
                        <div key={k} className="flex justify-between py-2.5 border-b border-[#6b21a8]/40 last:border-0"><span className="text-slate-400">{k}</span><span className="font-semibold">{String(v)}</span></div>
                      ))}
                      <div className="pt-3"><p className="text-slate-400 mb-1">Description</p><p className="text-sm text-slate-300 whitespace-pre-line">{profile.description || 'No description.'}</p></div>
                    </Card>
                  </div>
                )
              })()}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  )
}

function DashboardView({ api, go, user }) {
  const [orders, setOrders] = useState([])
  const [wishlist, setWishlist] = useState([])
  const loadAll = useCallback(async () => { try { const [o, w] = await Promise.all([api('/orders'), api('/wishlist')]); setOrders(o.purchases || []); setWishlist(w.items || []) } catch (e) { toast.error(e.message) } }, [api])
  useEffect(() => { loadAll() }, [loadAll])
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <img src={user.avatarUrl} className="w-16 h-16 border-2 bg-white/10" style={{ borderColor: 'var(--eth-gold)' }} alt="" />
        <div><h1 className="font-cinzel font-bold text-2xl tracking-wide" style={{ color: 'var(--eth-ink)' }}>{user.username}</h1><p className="text-sm text-slate-400">Buyer account · pays with crypto</p></div>
        {user.isAdmin && <Button className="ml-auto rounded-none border" style={{ background: 'rgba(244,114,182,0.15)', color: 'var(--eth-lavender)', borderColor: 'rgba(244,114,182,0.3)' }} variant="outline" onClick={() => go('admin')}><Shield className="w-4 h-4 mr-1" /> Admin Console</Button>}
      </div>
      <Tabs defaultValue="purchases">
        <TabsList className="rounded-none border" style={{ background: 'rgba(20,10,36,0.6)', borderColor: 'var(--eth-gold-dim)' }}><TabsTrigger value="purchases" className="font-pixel text-[10px] tracking-wider">Purchases</TabsTrigger><TabsTrigger value="wishlist" className="font-pixel text-[10px] tracking-wider">Wishlist</TabsTrigger></TabsList>
        <TabsContent value="purchases" className="mt-5">
          {orders.length === 0 ? <Empty text="No purchases yet. Browse the marketplace to buy your first item." /> : (
            <div className="space-y-3">{orders.map(o => (
              <Card key={o.id} className="p-4 rounded-none border flex items-center gap-4 cursor-pointer" style={{ background: 'rgba(20,10,36,0.5)', borderColor: 'var(--eth-gold-dim)' }} onClick={() => go('order', { orderId: o.orderId })}>
                {o.item.imageUrl ? <img src={o.item.imageUrl} className="w-14 h-14 object-cover" alt="" /> : <div className="w-14 h-14 bg-white/[0.03] flex items-center justify-center shrink-0"><Package className="w-6 h-6 text-slate-600" /></div>}
                <div className="flex-1"><p className="font-bold">{o.item.name}</p><p className="text-xs text-slate-400">from {o.sellerName} · {new Date(o.createdAt).toLocaleDateString()} · paid in {o.currency}</p></div>
                <Badge className={o.status === 'paid' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : o.status === 'pending_payment' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-red-500/15 text-red-300 border-red-500/30'}>{o.status === 'pending_payment' ? 'pending' : o.status}</Badge>
                <PriceTag price={o.amountUsd} />
              </Card>))}</div>
          )}
        </TabsContent>
        <TabsContent value="wishlist" className="mt-5">
          {wishlist.length === 0 ? <Empty text="Your wishlist is empty. Tap the heart on any item." /> : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">{wishlist.map(it => (
              <Card key={it.id} onClick={() => go('browse', { search: it.name })} className="overflow-hidden rounded-none border cursor-pointer hover:border-[#c084fc]/40" style={{ background: 'rgba(20,10,36,0.5)', borderColor: 'var(--eth-gold-dim)' }}><img src={it.imageUrl} className="w-full aspect-square object-cover" alt="" /><div className="p-2"><p className="text-xs font-semibold truncate">{it.name}</p></div></Card>))}</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ================= Admin =================
function VerifiedFooter({ className = '', sources }) {
  const list = (sources && sources.length) ? sources : ['eBay', 'SellAuth']
  return (
    <div className={`flex items-center justify-center gap-1.5 text-xs text-slate-500 flex-wrap ${className}`}>
      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
      <span>Verified on</span>
      <span className="font-semibold text-slate-300">{list.join(' · ')}</span>
    </div>
  )
}

const SRC_LABEL = { ebay: 'eBay', eldorado: 'Eldorado', sellauth: 'SellAuth', g2g: 'G2G', playerauctions: 'PlayerAuctions', manual: 'Verified', other: 'Verified' }

function ReviewCard({ r }) {
  const neg = r.rating === 'negative'
  const neu = r.rating === 'neutral'
  const Icon = neg ? ThumbsDown : neu ? AlertTriangle : ThumbsUp
  const ring = neg ? 'border-red-500/25' : neu ? 'border-amber-500/25' : 'border-emerald-500/20'
  const chip = neg ? 'bg-red-500/15 text-red-300' : neu ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'
  const known = ['ebay', 'eldorado', 'sellauth', 'g2g', 'playerauctions'].includes(r.source)
  return (
    <Card className={`p-4 bg-[#140a24]/60 ${ring} flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${chip}`}><Icon className="w-3.5 h-3.5" /> {neg ? 'Negative' : neu ? 'Neutral' : 'Positive'}</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">{known && <BadgeCheck className="w-3 h-3 text-sky-400" />} {SRC_LABEL[r.source] || 'Verified'}</span>
      </div>
      <div className="relative">
        <Quote className="w-4 h-4 text-white/10 absolute -top-1 -left-1" />
        <p className="text-sm text-slate-200 leading-relaxed pl-4">{r.comment}</p>
      </div>
      {r.item && <p className="text-xs text-slate-500 truncate">Item: {r.item}</p>}
      <div className="flex items-center justify-between text-xs text-slate-400 mt-auto pt-1 border-t border-[#6b21a8]/40">
        <span className="font-semibold text-slate-300">{r.author || 'Buyer'}</span>
        {r.period && <span className="text-slate-500">{r.period}</span>}
      </div>
    </Card>
  )
}

const REVIEWS_PAGE_SIZE = 12

function Pager({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 mt-8">
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} className="font-pixel text-[9px] tracking-wider px-3 py-2 border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ borderColor: 'var(--eth-gold-dim)', color: 'var(--eth-muted)' }}>PREV</button>
      <span className="text-xs" style={{ color: 'var(--eth-muted)' }}>Page {page} of {totalPages}</span>
      <button onClick={() => onPage(page + 1)} disabled={page >= totalPages} className="font-pixel text-[9px] tracking-wider px-3 py-2 border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ borderColor: 'var(--eth-gold-dim)', color: 'var(--eth-muted)' }}>NEXT</button>
    </div>
  )
}

function ReviewsView({ api }) {
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  useEffect(() => { api('/reviews').then(setData).catch(e => toast.error(e.message)) }, [api])
  if (!data) return <div className="container mx-auto px-4 py-32 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-[#c084fc]" /></div>
  const reviews = data.reviews || []
  const totalPages = Math.max(1, Math.ceil(reviews.length / REVIEWS_PAGE_SIZE))
  const pageClamped = Math.min(page, totalPages)
  const pageReviews = reviews.slice((pageClamped - 1) * REVIEWS_PAGE_SIZE, pageClamped * REVIEWS_PAGE_SIZE)
  const goToPage = (p) => { setPage(Math.min(Math.max(1, p), totalPages)); window.scrollTo({ top: document.getElementById('reviews-grid')?.offsetTop - 100 || 0, behavior: 'smooth' }) }
  const positives = reviews.filter(r => r.rating === 'positive').length
  const pct = reviews.length ? Math.round((positives / reviews.length) * 100) : 100
  const sbs = data.salesBySource || {}
  const srcSet = new Set()
  ;['ebay', 'eldorado', 'sellauth', 'g2g', 'playerauctions'].forEach(k => { if ((sbs[k] || 0) > 0) srcSet.add(SRC_LABEL[k]) })
  reviews.forEach(r => { if (SRC_LABEL[r.source] && r.source !== 'manual' && r.source !== 'other') srcSet.add(SRC_LABEL[r.source]) })
  const sources = [...srcSet]

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      {/* Total sales */}
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400 mb-2">Total Sales</p>
        <p className="text-6xl md:text-7xl font-black bg-gradient-to-r from-[#c084fc] via-[#f472b6] to-amber-200 bg-clip-text text-transparent leading-none">{Number(data.totalSales || 0).toLocaleString()}</p>
        <VerifiedFooter className="mt-4" sources={sources} />
      </div>

      {/* quick stats */}
      <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto mt-10">
        <Card className="p-4 bg-[#140a24]/60 border-[#6b21a8]/40 text-center"><p className="text-2xl font-black text-emerald-300">{pct}%</p><p className="text-[11px] uppercase tracking-wider text-slate-500 mt-1">Positive</p></Card>
        <Card className="p-4 bg-[#140a24]/60 border-[#6b21a8]/40 text-center"><p className="text-2xl font-black text-[#c084fc]">{reviews.length}</p><p className="text-[11px] uppercase tracking-wider text-slate-500 mt-1">Reviews</p></Card>
        <Card className="p-4 bg-[#140a24]/60 border-[#6b21a8]/40 text-center"><p className="text-2xl font-black text-amber-300 flex items-center justify-center gap-1"><Star className="w-5 h-5 fill-amber-300" /></p><p className="text-[11px] uppercase tracking-wider text-slate-500 mt-1">Trusted</p></Card>
      </div>

      {/* Reviews */}
      <div id="reviews-grid" className="mt-14">
        <h2 className="text-2xl font-black mb-1 text-center">Customer Reviews</h2>
        <p className="text-sm text-slate-400 mb-8 text-center">Real feedback from completed orders.</p>
        {reviews.length === 0 ? (
          <p className="text-center text-slate-500 py-12">No reviews yet. Check back soon.</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pageReviews.map(r => <ReviewCard key={r.id} r={r} />)}
            </div>
            <Pager page={pageClamped} totalPages={totalPages} onPage={goToPage} />
          </>
        )}
        <VerifiedFooter className="mt-10" sources={sources} />
      </div>
    </div>
  )
}

function AdminView({ api, user, go, cfg, initialTab }) {
  const [tab, setTab] = useState(initialTab || 'listings')
  const [stats, setStats] = useState(null)
  const [items, setItems] = useState([])
  const [vendors, setVendors] = useState([])
  const [listings, setListings] = useState([])
  const [orders, setOrders] = useState([])
  const [users, setUsers] = useState([])
  const [reports, setReports] = useState([])
  const [itemOpen, setItemOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editL, setEditL] = useState(null)
  const [vendorOpen, setVendorOpen] = useState(false)
  const [reviews, setReviews] = useState([])
  const [totalSales, setTotalSales] = useState(0)
  const [salesFields, setSalesFields] = useState({ ebay: '', eldorado: '', sellauth: '', g2g: '', playerauctions: '', other: '' })
  const [ebayUrl, setEbayUrl] = useState('')
  const [eldoradoUrl, setEldoradoUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importingEldorado, setImportingEldorado] = useState(false)
  const [newReview, setNewReview] = useState({ author: '', comment: '', rating: 'positive', item: '', source: 'ebay' })

  const loadReviews = useCallback(async () => {
    try { const rv = await api('/reviews'); setReviews(rv.reviews || []); setTotalSales(rv.totalSales || 0); const s = rv.salesBySource || {}; setSalesFields({ ebay: String(s.ebay || 0), eldorado: String(s.eldorado || 0), sellauth: String(s.sellauth || 0), g2g: String(s.g2g || 0), playerauctions: String(s.playerauctions || 0), other: String(s.other || 0) }) } catch (e) {}
  }, [api])
  const saveSales = async () => { try { const d = await api('/admin/reviews/settings', { method: 'POST', body: JSON.stringify({ salesBySource: { ebay: Number(salesFields.ebay) || 0, eldorado: Number(salesFields.eldorado) || 0, sellauth: Number(salesFields.sellauth) || 0, g2g: Number(salesFields.g2g) || 0, playerauctions: Number(salesFields.playerauctions) || 0, other: Number(salesFields.other) || 0 } }) }); setTotalSales(d.totalSales); toast.success('Sales updated') } catch (e) { toast.error(e.message) } }
  const importEbay = async () => {
    if (!ebayUrl.trim()) { toast.error('Paste an eBay feedback profile URL'); return }
    setImporting(true)
    try { const d = await api('/admin/reviews/import-ebay', { method: 'POST', body: JSON.stringify({ url: ebayUrl.trim(), setTotalSales: true }) }); toast.success(`Imported ${d.imported} review(s)${d.skipped ? `, skipped ${d.skipped} duplicate(s)` : ''}${d.feedbackScore != null ? ` · eBay score ${d.feedbackScore}` : ''}`); await loadReviews() }
    catch (e) { toast.error(e.message) } finally { setImporting(false) }
  }
  const importEldorado = async () => {
    if (!eldoradoUrl.trim()) { toast.error('Paste an Eldorado profile URL'); return }
    setImportingEldorado(true)
    try { const d = await api('/admin/reviews/import-eldorado', { method: 'POST', body: JSON.stringify({ url: eldoradoUrl.trim(), setTotalSales: true }) }); toast.success(`Imported ${d.imported} review(s)${d.skipped ? `, skipped ${d.skipped} duplicate(s)` : ''}${d.ratingCount != null ? ` · ${d.ratingCount} ratings (${d.positivePct}% positive)` : ''}`); await loadReviews() }
    catch (e) { toast.error(e.message) } finally { setImportingEldorado(false) }
  }
  const addReview = async () => {
    if (!newReview.comment.trim()) { toast.error('Enter a review comment'); return }
    try { await api('/admin/reviews', { method: 'POST', body: JSON.stringify({ ...newReview }) }); toast.success('Review added'); setNewReview({ author: '', comment: '', rating: 'positive', item: '', source: newReview.source }); await loadReviews() } catch (e) { toast.error(e.message) }
  }
  const deleteReview = async (id) => { try { await api(`/admin/reviews/${id}`, { method: 'DELETE' }); await loadReviews() } catch (e) { toast.error(e.message) } }

  // Discord Dashboard: generate a fresh one-time access code each time an admin opens the console
  // (unless an authenticator app is set up, in which case the server never generates or shows
  // a code at all — only your phone knows it).
  const [dash, setDash] = useState(null)
  const [showCode, setShowCode] = useState(false)
  const genDash = useCallback(async () => { try { const d = await api('/admin/dashboard/session', { method: 'POST' }); setDash(d) } catch (e) {} }, [api])
  useEffect(() => { if (user?.isAdmin) genDash() }, [genDash, user])

  const [totpEnabled, setTotpEnabled] = useState(false)
  const [totpSetup, setTotpSetup] = useState(null) // { secret, otpauthUrl, qrDataUrl }
  const [totpConfirmCode, setTotpConfirmCode] = useState('')
  const [totpConfirming, setTotpConfirming] = useState(false)
  const [totpDisableOpen, setTotpDisableOpen] = useState(false)
  const [totpDisableCode, setTotpDisableCode] = useState('')
  const [totpDisabling, setTotpDisabling] = useState(false)
  const loadTotpStatus = useCallback(async () => { try { const d = await api('/admin/dashboard/totp/status'); setTotpEnabled(!!d.enabled) } catch (e) {} }, [api])
  useEffect(() => { if (user?.isAdmin) loadTotpStatus() }, [loadTotpStatus, user])
  const startTotpSetup = async () => { try { const d = await api('/admin/dashboard/totp/setup', { method: 'POST' }); setTotpSetup(d) } catch (e) { toast.error(e.message) } }
  const confirmTotpSetup = async () => {
    setTotpConfirming(true)
    try { await api('/admin/dashboard/totp/confirm', { method: 'POST', body: JSON.stringify({ code: totpConfirmCode.trim() }) }); toast.success('Authenticator app enabled'); setTotpSetup(null); setTotpConfirmCode(''); setTotpEnabled(true); await genDash() }
    catch (e) { toast.error(e.message) } finally { setTotpConfirming(false) }
  }
  const disableTotp = async () => {
    setTotpDisabling(true)
    try { await api('/admin/dashboard/totp/disable', { method: 'POST', body: JSON.stringify({ code: totpDisableCode.trim() }) }); toast.success('Authenticator app disabled'); setTotpEnabled(false); setTotpDisableOpen(false); setTotpDisableCode(''); await genDash() }
    catch (e) { toast.error(e.message) } finally { setTotpDisabling(false) }
  }

  // Import digital goods (accounts / toy codes) from the admin area
  const [accOpen, setAccOpen] = useState(false)
  const [tcOpen, setTcOpen] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [accPage, setAccPage] = useState(1)
  const [importInput, setImportInput] = useState('')
  const [importingAccount, setImportingAccount] = useState(false)
  const loadAccounts = useCallback(async () => { try { const d = await api('/admin/dashboard/accounts'); setAccounts(d.accounts || []) } catch (e) {} }, [api])
  const [tcForm, setTcForm] = useState({ title: '', price: '', imageUrl: '', code: '' })
  const importAccount = async () => {
    if (!importInput.trim()) { toast.error('Enter a Roblox UID or profile link'); return }
    setImportingAccount(true)
    try {
      const d = await api('/admin/dashboard/accounts/import', { method: 'POST', body: JSON.stringify({ input: importInput.trim() }) })
      toast.success(`Imported ${d.account.title}`)
      setAccOpen(false); setImportInput('')
      await loadAccounts()
      go('admin-account', { id: d.account.id })
    } catch (e) { toast.error(e.message) } finally { setImportingAccount(false) }
  }
  const submitToycode = async () => {
    if (!tcForm.title.trim() || !tcForm.code.trim()) { toast.error('Title and code are required'); return }
    try { await api('/admin/dashboard/toycodes', { method: 'POST', body: JSON.stringify({ ...tcForm, price: Number(tcForm.price) || 0 }) }); toast.success('Toy code added to Dashboard → Toy Codes'); setTcOpen(false); setTcForm({ title: '', price: '', imageUrl: '', code: '' }) } catch (e) { toast.error(e.message) }
  }

  const load = useCallback(async () => {
    try {
      const [s, i, v, l, o, u, r] = await Promise.all([api('/admin/stats'), api('/admin/items'), api('/admin/vendors'), api('/admin/listings'), api('/admin/orders'), api('/admin/users'), api('/admin/reports')])
      setStats(s); setItems(i.items); setVendors(v.vendors); setListings(l.listings); setOrders(o.orders); setUsers(u.users); setReports(r.reports)
      await loadReviews()
      await loadAccounts()
    } catch (e) {}
  }, [api, loadReviews, loadAccounts])
  useEffect(() => { if (user?.isAdmin) load() }, [load, user])

  if (!user || !user.isAdmin) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <Shield className="w-12 h-12 mx-auto text-[#c084fc] mb-4" /><h2 className="text-2xl font-bold mb-2">Admin Access Required</h2>
        <p className="text-slate-400 max-w-md mx-auto">Sign in with the admin account to manage items, listings, users and orders.</p>
        <Button className="mt-4 bg-gradient-to-r from-[#c084fc] to-[#f472b6]" onClick={() => go('home')}>Go home</Button>
      </div>
    )
  }
  const removeListing = async (id) => { await api(`/admin/listings/${id}`, { method: 'DELETE' }); toast.success('Listing removed'); load() }
  const removeItem = async (id) => { await api(`/admin/items/${id}`, { method: 'DELETE' }); toast.success('Item deleted'); load() }
  const removeUser = async (id) => { await api(`/admin/users/${id}`, { method: 'DELETE' }); toast.success('User removed'); load() }
  const resolveReport = async (id) => { await api(`/admin/reports/${id}`, { method: 'POST' }); toast.success('Report resolved'); load() }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-cinzel font-bold text-3xl flex items-center gap-2.5 tracking-wide" style={{ color: 'var(--eth-ink)' }}><Shield className="w-7 h-7" style={{ color: 'var(--eth-gold)' }} /> Admin Console</h1>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="border-white/10" onClick={() => setVendorOpen(true)}><Store className="w-4 h-4 mr-1" /> New Store</Button>
          <Button variant="outline" className="border-white/10" onClick={() => setAccOpen(true)}><User className="w-4 h-4 mr-1" /> Import Account</Button>
          <Button variant="outline" className="border-white/10" onClick={() => setTcOpen(true)}><Ticket className="w-4 h-4 mr-1" /> Import Toy Code</Button>
          <Button className="bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold" onClick={() => setImportOpen(true)}><Plus className="w-4 h-4 mr-1" /> Import from Roblox</Button>
        </div>
      </div>

      <Dialog open={accOpen} onOpenChange={setAccOpen}>
        <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><User className="w-5 h-5 text-[#c084fc]" /> Import Roblox account</DialogTitle><DialogDescription className="text-slate-400">Enter a UID, username, or profile link. We'll pull the real name, join date, limiteds, items, animations & game passes and build a page for it — you set the price and list it whenever you're ready.</DialogDescription></DialogHeader>
          <Input value={importInput} onChange={e => setImportInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !importingAccount && importAccount()} placeholder="https://www.roblox.com/users/156/profile  ·  builderman  ·  156" className="bg-black/30 border-white/10" />
          <DialogFooter><Button variant="ghost" onClick={() => setAccOpen(false)}>Cancel</Button><Button onClick={importAccount} disabled={importingAccount} className="bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">{importingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Import'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tcOpen} onOpenChange={setTcOpen}>
        <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Ticket className="w-5 h-5 text-[#f472b6]" /> Import Roblox toy code</DialogTitle><DialogDescription className="text-slate-400">Added to Discord Dashboard → Toy Codes. Delivered on /claim after you assign it to an order.</DialogDescription></DialogHeader>
          <div className="grid sm:grid-cols-2 gap-2">
            <Input value={tcForm.title} onChange={e => setTcForm({ ...tcForm, title: e.target.value })} placeholder="Title (e.g. Roblox Toy - Ninja)" className="bg-black/30 border-white/10 sm:col-span-2" />
            <Input value={tcForm.code} onChange={e => setTcForm({ ...tcForm, code: e.target.value })} placeholder="Toy code (e.g. ABC-123-XYZ)" className="bg-black/30 border-white/10" />
            <Input value={tcForm.price} onChange={e => setTcForm({ ...tcForm, price: e.target.value })} placeholder="Price (USD)" type="number" className="bg-black/30 border-white/10" />
            <Input value={tcForm.imageUrl} onChange={e => setTcForm({ ...tcForm, imageUrl: e.target.value })} placeholder="Image URL (optional)" className="bg-black/30 border-white/10 sm:col-span-2" />
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setTcOpen(false)}>Cancel</Button><Button onClick={submitToycode} className="bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">Add toy code</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {!cfg?.cryptoConfigured && <div className="mb-6 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-center gap-2"><Bitcoin className="w-4 h-4" /> Crypto checkout is in DEMO mode. Add your BlockBee API key to <code className="mx-1">BLOCKBEE_API_KEY</code> in the server env to accept real payments.</div>}

      {/* Secret Discord Dashboard access */}
      <Card className="mb-6 p-4 bg-gradient-to-br from-indigo-500/10 to-[#c084fc]/5 border-indigo-500/20">
        <div className="flex items-center gap-2 mb-1"><MessageSquare className="w-5 h-5 text-indigo-400" /><h3 className="font-black">Discord Dashboard</h3><Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Secret</Badge></div>
        <p className="text-xs text-slate-400 mb-3">A separate, hidden dashboard. Access needs this private link + your admin login + a second factor{totpEnabled ? ' from your authenticator app' : ' (a one-time code below, single-use, expires in ~10 min, regenerated each visit)'}.</p>
        {dash ? (
          <div className="flex flex-col gap-3">
            {totpEnabled ? (
              <div className="flex items-center gap-2 text-sm"><ShieldCheck className="w-4 h-4 text-emerald-400" /><span className="text-emerald-300 font-semibold">Authenticator app enabled</span><span className="text-slate-500">— open your Discord Dashboard link and enter the current code from your app.</span></div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400">One-time code:</span>
                <span className="font-mono font-black text-lg tracking-[0.3em] text-white bg-black/40 px-3 py-1 rounded-lg border border-white/10">{showCode ? dash.code : '••••••'}</span>
                <Button size="sm" variant="ghost" className="text-slate-300" onClick={() => setShowCode(v => !v)}>{showCode ? 'Hide' : 'Show'}</Button>
                <Button size="sm" variant="ghost" className="text-slate-300" onClick={() => copyText(dash.code, 'Code copied')}>Copy code</Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="bg-gradient-to-r from-indigo-500 to-[#c084fc] font-semibold" onClick={() => window.open(dash.url, '_blank')}><MessageSquare className="w-4 h-4 mr-1" /> Open Discord Dashboard</Button>
              <Button size="sm" variant="outline" className="border-white/10" onClick={() => copyText(dash.url, 'Secret link copied')}>Copy secret link</Button>
              {!totpEnabled && <Button size="sm" variant="ghost" className="text-slate-400" onClick={genDash}>Regenerate code</Button>}
              {totpEnabled && <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => setTotpDisableOpen(v => !v)}>Disable authenticator</Button>}
            </div>

            {totpDisableOpen && (
              <div className="p-3 rounded-lg bg-black/30 border border-red-500/20 flex flex-wrap items-center gap-2">
                <Input value={totpDisableCode} onChange={e => setTotpDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Current 6-digit app code" className="bg-black/30 border-white/10 w-48 font-mono" />
                <Button size="sm" variant="destructive" disabled={totpDisabling || totpDisableCode.length < 6} onClick={disableTotp}>{totpDisabling ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm disable'}</Button>
              </div>
            )}

            {!totpEnabled && !totpSetup && (
              <Button size="sm" variant="outline" className="border-emerald-500/30 text-emerald-300 hover:text-emerald-200 w-fit" onClick={startTotpSetup}><ShieldCheck className="w-4 h-4 mr-1" /> Set up Authenticator App (recommended)</Button>
            )}

            {totpSetup && (
              <div className="p-4 rounded-xl bg-black/30 border border-emerald-500/20 flex flex-col sm:flex-row gap-4">
                <img src={totpSetup.qrDataUrl} alt="Authenticator QR code" className="w-40 h-40 rounded-lg bg-white p-2 shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-sm font-semibold text-slate-200">Scan with Google Authenticator (or any TOTP app)</p>
                  <p className="text-xs text-slate-500">Can't scan? Enter this key manually:</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono bg-black/40 px-2 py-1 rounded break-all">{totpSetup.secret}</code>
                    <Button size="sm" variant="ghost" className="text-slate-400 shrink-0" onClick={() => copyText(totpSetup.secret, 'Secret copied')}>Copy</Button>
                  </div>
                  <p className="text-xs text-slate-400 pt-1">Then enter the current 6-digit code it shows to confirm:</p>
                  <div className="flex items-center gap-2">
                    <Input value={totpConfirmCode} onChange={e => setTotpConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="bg-black/30 border-white/10 w-32 font-mono tracking-widest" />
                    <Button size="sm" disabled={totpConfirming || totpConfirmCode.length < 6} onClick={confirmTotpSetup} className="bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold">{totpConfirming ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm & enable'}</Button>
                    <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => { setTotpSetup(null); setTotpConfirmCode('') }}>Cancel</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : <p className="text-xs text-slate-500">Generating secure access code…</p>}
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-8">
        {stats && [['Users', stats.users], ['Items', stats.items], ['Listings', stats.listings], ['Orders', stats.orders], ['Revenue', usd(stats.revenue)], ['Reports', stats.reports]].map(([k, v]) => (
          <Card key={k} className="p-4 bg-[#140a24]/60 border-[#6b21a8]/40 rounded-none"><p className="font-pixel text-[8px] tracking-widest text-slate-400">{k.toUpperCase()}</p><p className="font-vt text-3xl mt-1" style={{ color: 'var(--eth-teal)' }}>{v}</p></Card>
        ))}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-[#12101f] border border-[#6b21a8]/40 flex-wrap h-auto rounded-none"><TabsTrigger value="listings" className="font-pixel text-[9px] tracking-wider">Listings</TabsTrigger><TabsTrigger value="items" className="font-pixel text-[9px] tracking-wider">Items</TabsTrigger><TabsTrigger value="orders" className="font-pixel text-[9px] tracking-wider">Transactions</TabsTrigger><TabsTrigger value="users" className="font-pixel text-[9px] tracking-wider">Users</TabsTrigger><TabsTrigger value="reports" className="font-pixel text-[9px] tracking-wider">Reports</TabsTrigger><TabsTrigger value="reviews" className="font-pixel text-[9px] tracking-wider"><MessageSquare className="w-3.5 h-3.5 mr-1" /> Reviews</TabsTrigger><TabsTrigger value="profiles" className="font-pixel text-[9px] tracking-wider"><User className="w-3.5 h-3.5 mr-1" /> Profiles</TabsTrigger><TabsTrigger value="chat" className="font-pixel text-[9px] tracking-wider"><MessageSquare className="w-3.5 h-3.5 mr-1" /> Support Chat</TabsTrigger></TabsList>

        <TabsContent value="listings" className="mt-4 space-y-2">
          {listings.length === 0 && <Empty text="No listings yet. Click 'Import from Roblox' to add one." />}
          {listings.map(l => (
            <Card key={l.id} className="p-3 bg-[#140a24]/60 border-[#6b21a8]/40 flex items-center gap-3">
              <img src={l.item.imageUrl} className="w-10 h-10 rounded object-cover bg-white/5" alt="" />
              <div className="flex-1"><p className="font-semibold text-sm">{l.item.name}</p><p className="text-xs text-slate-400">{l.sellerName} · {usd(l.price)} · {l.condition} · <span className={l.status === 'sold' ? 'text-red-400' : 'text-emerald-400'}>{l.status}</span>{typeof l.stock === 'number' ? ` · ${l.stock} in stock` : ''}</p></div>
              {l.status !== 'removed' && <Button size="sm" variant="outline" className="border-white/10" onClick={() => setEditL(l)}>Edit stock</Button>}
              {l.status !== 'removed' && <Button size="sm" variant="destructive" onClick={() => removeListing(l.id)}><Trash2 className="w-3.5 h-3.5" /></Button>}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="items" className="mt-4 space-y-2">
          {items.map(it => (
            <Card key={it.id} className="p-3 bg-[#140a24]/60 border-[#6b21a8]/40 flex items-center gap-3">
              <img src={it.imageUrl} className="w-10 h-10 rounded object-cover" alt="" />
              <div className="flex-1"><p className="font-semibold text-sm">{it.name}</p><p className="text-xs text-slate-400">{it.category} · Roblox ID {it.robloxItemId || 'N/A'}</p></div>
              <Button size="sm" variant="destructive" onClick={() => removeItem(it.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="orders" className="mt-4 space-y-2">
          {orders.length === 0 && <Empty text="No transactions yet." />}
          {orders.map(o => (
            <a key={o.id} href={o.txNumber ? `/transaction/${o.txNumber}` : undefined} target="_blank" rel="noopener noreferrer" className="block">
              <Card className="p-3 bg-[#140a24]/60 border-[#6b21a8]/40 flex items-center gap-3 hover:border-[#c084fc]/40 transition-colors cursor-pointer">
                {o.item.imageUrl ? <img src={o.item.imageUrl} className="w-9 h-9 rounded object-cover" alt="" /> : <div className="w-9 h-9 rounded bg-white/[0.03] flex items-center justify-center shrink-0"><Package className="w-4 h-4 text-slate-600" /></div>}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm flex items-center gap-2">{o.txNumber ? <Badge className="bg-[#c084fc]/15 text-[#c084fc] border-[#c084fc]/30">#{o.txNumber}</Badge> : null} <span className="truncate">{o.item.name}</span></p>
                  <p className="text-xs text-slate-400 truncate">{o.buyerInfo?.discordName ? `Discord: ${o.buyerInfo.discordName}${o.buyerInfo.discordTag ? '#' + o.buyerInfo.discordTag : ''} · ` : ''}{o.buyerInfo?.robloxUsername ? `Roblox: ${o.buyerInfo.robloxUsername} · ` : ''}{new Date(o.createdAt).toLocaleString()}</p>
                </div>
                <Badge className={o.status === 'paid' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}>{o.status === 'pending_payment' ? 'pending' : o.status}</Badge>
                <PriceTag price={o.amountUsd} />
              </Card>
            </a>
          ))}
        </TabsContent>

        <TabsContent value="users" className="mt-4 space-y-2">
          {users.map(u => (
            <Card key={u.id} className="p-3 bg-[#140a24]/60 border-[#6b21a8]/40 flex items-center gap-3">
              <img src={u.avatarUrl} className="w-9 h-9 rounded-full bg-white/10" alt="" />
              <div className="flex-1"><div className="font-semibold text-sm flex items-center gap-1">{u.username} {u.isAdmin && <Badge className="bg-[#f472b6]/20 text-[#f472b6]">admin</Badge>}</div><p className="text-xs text-slate-400">{u.email} · joined {new Date(u.createdAt).toLocaleDateString()}</p></div>
              {!u.isAdmin && <Button size="sm" variant="destructive" onClick={() => removeUser(u.id)}><Trash2 className="w-3.5 h-3.5" /></Button>}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="reports" className="mt-4 space-y-2">
          {reports.length === 0 && <Empty text="No reports." />}
          {reports.map(r => (
            <Card key={r.id} className="p-3 bg-[#140a24]/60 border-[#6b21a8]/40 flex items-center gap-3">
              <Flag className="w-5 h-5 text-red-400" />
              <div className="flex-1"><p className="font-semibold text-sm">{r.reason}</p><p className="text-xs text-slate-400">by {r.reporterName} · {r.status}</p></div>
              {r.status === 'open' && <Button size="sm" onClick={() => resolveReport(r.id)}>Resolve</Button>}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="reviews" className="mt-4 space-y-5">
          {/* Total sales (combined across sources) */}
          <Card className="p-4 bg-[#140a24]/60 border-[#6b21a8]/40 rounded-none">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-slate-400">Sales by source (combined into Total Sales on the public page)</Label>
              <span className="text-xs text-slate-500">Total: <span className="text-slate-200 font-bold">{Number(totalSales).toLocaleString()}</span></span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[['ebay', 'eBay'], ['eldorado', 'Eldorado'], ['sellauth', 'SellAuth'], ['g2g', 'G2G'], ['playerauctions', 'PlayerAuctions'], ['other', 'Other']].map(([k, label]) => (
                <div key={k}>
                  <Label className="text-[11px] text-slate-500">{label}</Label>
                  <Input type="number" value={salesFields[k]} onChange={e => setSalesFields({ ...salesFields, [k]: e.target.value })} placeholder="0" className="bg-black/30 border-white/10 mt-1" />
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3"><Button onClick={saveSales} className="bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">Save sales</Button></div>
          </Card>

          {/* eBay import */}
          <Card className="p-4 bg-[#140a24]/60 border-[#6b21a8]/40 rounded-none">
            <div className="flex items-center gap-2 mb-2"><Upload className="w-4 h-4 text-emerald-400" /><h3 className="font-bold text-sm">Auto-detect from eBay feedback</h3></div>
            <p className="text-xs text-slate-400 mb-3">Paste your eBay feedback profile URL. We'll import received-as-seller feedback and set the eBay sales count from your eBay feedback score.</p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Input value={ebayUrl} onChange={e => setEbayUrl(e.target.value)} placeholder="https://www.ebay.com/fdbk/feedback_profile/USERNAME?filter=feedback_page%3ARECEIVED_AS_SELLER" className="bg-black/30 border-white/10 flex-1" />
              <Button onClick={importEbay} disabled={importing} className="bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold">{importing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Detecting...</> : <><Upload className="w-4 h-4 mr-2" /> Detect &amp; Import</>}</Button>
            </div>
          </Card>

          {/* Eldorado import */}
          <Card className="p-4 bg-[#140a24]/60 border-[#6b21a8]/40 rounded-none">
            <div className="flex items-center gap-2 mb-2"><Upload className="w-4 h-4 text-[#c084fc]" /><h3 className="font-bold text-sm">Auto-detect from Eldorado reviews</h3></div>
            <p className="text-xs text-slate-400 mb-3">Paste your Eldorado profile URL. We'll import your written reviews and set the Eldorado sales count from your total rating count.</p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Input value={eldoradoUrl} onChange={e => setEldoradoUrl(e.target.value)} placeholder="https://www.eldorado.gg/users/USERNAME/reviews" className="bg-black/30 border-white/10 flex-1" />
              <Button onClick={importEldorado} disabled={importingEldorado} className="bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">{importingEldorado ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Detecting...</> : <><Upload className="w-4 h-4 mr-2" /> Detect &amp; Import</>}</Button>
            </div>
          </Card>

          {/* Manual add (any source) */}
          <Card className="p-4 bg-[#140a24]/60 border-[#6b21a8]/40 rounded-none">
            <div className="flex items-center gap-2 mb-3"><Plus className="w-4 h-4 text-[#c084fc]" /><h3 className="font-bold text-sm">Add a review from any source</h3></div>
            <p className="text-xs text-slate-400 mb-3 -mt-2">G2G and PlayerAuctions don't have an auto-import yet — add those reviews here, and track their sales counts in the box above.</p>
            <div className="grid sm:grid-cols-3 gap-2">
              <Input value={newReview.author} onChange={e => setNewReview({ ...newReview, author: e.target.value })} placeholder="Buyer name (e.g. j***n)" className="bg-black/30 border-white/10" />
              <Select value={newReview.source} onValueChange={v => setNewReview({ ...newReview, source: v })}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent><SelectItem value="ebay">eBay</SelectItem><SelectItem value="eldorado">Eldorado</SelectItem><SelectItem value="sellauth">SellAuth</SelectItem><SelectItem value="g2g">G2G</SelectItem><SelectItem value="playerauctions">PlayerAuctions</SelectItem><SelectItem value="manual">Manual</SelectItem></SelectContent>
              </Select>
              <Select value={newReview.rating} onValueChange={v => setNewReview({ ...newReview, rating: v })}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="positive">Positive</SelectItem><SelectItem value="neutral">Neutral</SelectItem><SelectItem value="negative">Negative</SelectItem></SelectContent>
              </Select>
              <Input value={newReview.item} onChange={e => setNewReview({ ...newReview, item: e.target.value })} placeholder="Item (optional)" className="bg-black/30 border-white/10 sm:col-span-3" />
              <Textarea value={newReview.comment} onChange={e => setNewReview({ ...newReview, comment: e.target.value })} placeholder="Review comment" className="bg-black/30 border-white/10 sm:col-span-3" />
            </div>
            <div className="flex justify-end mt-3"><Button onClick={addReview} className="bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">Add review</Button></div>
          </Card>

          {/* Existing reviews */}
          <div>
            <p className="text-xs text-slate-400 mb-2">{reviews.length} review(s)</p>
            <div className="space-y-2">
              {reviews.map(r => (
                <Card key={r.id} className="p-3 bg-[#140a24]/60 border-[#6b21a8]/40 flex items-start gap-3">
                  <span className={`mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${r.rating === 'negative' ? 'bg-red-500/15 text-red-300' : r.rating === 'neutral' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{r.rating}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200">{r.comment}</p>
                    <p className="text-xs text-slate-500 mt-1">{r.author || 'Buyer'}{r.item ? ` · ${r.item}` : ''}{r.period ? ` · ${r.period}` : ''} · <span className="uppercase">{r.source}</span></p>
                  </div>
                  <Button size="icon" variant="ghost" className="text-slate-500 hover:text-red-400 shrink-0" onClick={() => deleteReview(r.id)}><Trash2 className="w-4 h-4" /></Button>
                </Card>
              ))}
              {reviews.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">No reviews yet. Import from eBay or add one manually.</p>}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="profiles" className="mt-6">
          <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2"><User className="w-5 h-5" style={{ color: 'var(--eth-gold)' }} /><h2 className="text-xl font-bold" style={{ color: 'var(--eth-ink)' }}>Imported Accounts</h2></div>
            <Button className="font-semibold border-0" style={{ background: 'linear-gradient(90deg, var(--eth-gold), var(--eth-lavender))', color: 'var(--eth-night1)' }} onClick={() => setAccOpen(true)}><Plus className="w-4 h-4 mr-1" /> Import account</Button>
          </div>
          {accounts.length === 0 ? <Empty text="No imported accounts yet. Click 'Import account' and paste a UID or profile link." /> : (() => {
            const totalPages = Math.max(1, Math.ceil(accounts.length / 12))
            const pageClamped = Math.min(accPage, totalPages)
            const pageAccounts = accounts.slice((pageClamped - 1) * 12, pageClamped * 12)
            return (
              <div id="imported-accounts-grid" className="mb-10">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {pageAccounts.map(a => {
                    const listed = a.status === 'available'
                    return (
                      <Card key={a.id} className="overflow-hidden cursor-pointer transition-colors group" style={{ background: 'var(--eth-night1)', borderColor: 'var(--eth-gold-dim)' }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--eth-gold)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--eth-gold-dim)'}
                        onClick={() => go('admin-account', { id: a.id })}>
                        <div className="aspect-square overflow-hidden" style={{ background: 'rgba(107,33,168,0.12)' }}>
                          <img src={a.snapshot?.profile?.headshotUrl || a.imageUrl} className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300" alt="" />
                        </div>
                        <div className="p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-sm truncate" style={{ color: 'var(--eth-ink)' }}>{a.title}</p>
                            <Badge className={`shrink-0 ${listed ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>{listed ? 'Listed' : 'Draft'}</Badge>
                          </div>
                          <p className="text-xs" style={{ color: 'var(--eth-muted)' }}>{a.snapshot?.limiteds?.length ? `${a.snapshot.limiteds.length} limiteds · ` : ''}{a.price ? usd(a.price) : 'No price set'}</p>
                        </div>
                      </Card>
                    )
                  })}
                </div>
                <Pager page={pageClamped} totalPages={totalPages} onPage={(p) => { setAccPage(Math.min(Math.max(1, p), totalPages)); window.scrollTo({ top: document.getElementById('imported-accounts-grid')?.offsetTop - 100 || 0, behavior: 'smooth' }) }} />
              </div>
            )
          })()}
          <details>
            <summary className="cursor-pointer text-sm text-slate-400 hover:text-slate-200 mb-3">Just look up a profile, without importing</summary>
            <ProfilesView api={api} embedded />
          </details>
        </TabsContent>

        <TabsContent value="chat" className="mt-6">
          <AdminChatPanel api={api} />
        </TabsContent>
      </Tabs>

      <CreateVendorDialog open={vendorOpen} setOpen={setVendorOpen} api={api} onCreated={() => { load(); toast.success('Store created') }} />
      <ImportListingDialog open={importOpen} setOpen={setImportOpen} api={api} vendors={vendors} onCreated={() => { load(); toast.success('Item listed on the marketplace') }} />
      <EditStockDialog listing={editL} setListing={setEditL} api={api} onSaved={() => { load(); toast.success('Listing updated') }} />
    </div>
  )
}

// Shared by the admin import-review page and the public profile page — same inventory,
// same look, so a listing reads identically whether you're the seller or the buyer.
function ProfileInventoryTabs({ limiteds, items, gamepasses }) {
  return (
    <Tabs defaultValue="limiteds">
      <TabsList className="bg-black/30 border" style={{ borderColor: 'var(--eth-gold-dim)' }}>
        <TabsTrigger value="limiteds">Limiteds ({limiteds.length})</TabsTrigger>
        <TabsTrigger value="items">Items ({items.length})</TabsTrigger>
        <TabsTrigger value="gamepasses"><Gamepad2 className="w-3.5 h-3.5 mr-1" /> Game Passes ({gamepasses.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="limiteds" className="mt-4">
        {limiteds.length === 0 ? <Empty text="No public limiteds found (or inventory was private at import time)." />
          : <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {limiteds.map(it => (
                <Card key={it.assetId} className="overflow-hidden" style={{ background: 'var(--eth-night1)', borderColor: 'var(--eth-gold-dim)' }}>
                  <div className="aspect-square bg-white/[0.03]"><img src={it.imageUrl} className="w-full h-full object-cover" alt="" /></div>
                  <div className="p-3"><p className="text-sm font-semibold truncate" style={{ color: 'var(--eth-ink)' }}>{it.name}</p>
                    <div className="flex justify-between items-center mt-1"><span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--eth-muted)' }}>RAP</span><span className="text-sm font-bold" style={{ color: 'var(--eth-teal)' }}>{it.rap != null ? Number(it.rap).toLocaleString() : '—'}</span></div>
                    {it.serialNumber && <p className="text-[10px] mt-0.5" style={{ color: 'var(--eth-gold)' }}>#{it.serialNumber}</p>}
                  </div>
                </Card>
              ))}
            </div>}
      </TabsContent>
      <TabsContent value="items" className="mt-4">
        {items.length === 0 ? <Empty text="No public regular items found (offsale/UGC/animations included — or inventory was private at import time)." />
          : <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {items.map(it => (
                <Card key={it.assetId} className="overflow-hidden" style={{ background: 'var(--eth-night1)', borderColor: 'var(--eth-gold-dim)' }}>
                  <div className="aspect-square bg-white/[0.03]"><img src={it.imageUrl} className="w-full h-full object-cover" alt="" /></div>
                  <div className="p-2"><p className="text-xs font-semibold truncate" style={{ color: 'var(--eth-ink)' }}>{it.name}</p><p className="text-[10px]" style={{ color: 'var(--eth-muted)' }}>{it.category}</p></div>
                </Card>
              ))}
            </div>}
      </TabsContent>
      <TabsContent value="gamepasses" className="mt-4">
        {gamepasses.length === 0 ? <Empty text="No public game passes found." />
          : <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {gamepasses.map(p => (
                <Card key={p.id} className="p-3 flex items-center gap-3" style={{ background: 'var(--eth-night1)', borderColor: 'var(--eth-gold-dim)' }}>
                  <img src={p.imageUrl} className="w-12 h-12 rounded-lg object-cover bg-white/5" alt="" />
                  <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate" style={{ color: 'var(--eth-ink)' }}>{p.name}</p><p className="text-xs truncate" style={{ color: 'var(--eth-muted)' }}>{p.universe}</p></div>
                  <span className="text-sm font-bold shrink-0" style={{ color: 'var(--eth-teal)' }}>{p.price != null ? `${p.price} R$` : 'Free'}</span>
                </Card>
              ))}
            </div>}
      </TabsContent>
    </Tabs>
  )
}

function AdminAccountView({ api, go, id, user }) {
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api(`/admin/dashboard/accounts/${id}`)
      setAccount(d.account)
      setForm({
        title: d.account.title || '', description: d.account.description || '', price: String(d.account.price || ''), imageUrl: d.account.imageUrl || '',
        credentials: {
          username: d.account.credentials?.username || '', password: d.account.credentials?.password || '',
          email: d.account.credentials?.email || '', notes: d.account.credentials?.notes || '',
        },
      })
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }, [api, id])
  useEffect(() => { load() }, [load])

  const save = async (extra = {}) => {
    setSaving(true)
    try {
      const d = await api(`/admin/dashboard/accounts/${id}`, { method: 'PUT', body: JSON.stringify({ ...form, price: Number(form.price) || 0, ...extra }) })
      setAccount(d.account)
      toast.success(extra.status === 'available' ? 'Listed for sale — live on the Profiles storefront' : extra.status === 'draft' ? 'Unlisted' : 'Saved')
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!window.confirm('Delete this imported account permanently? This cannot be undone.')) return
    try { await api(`/admin/dashboard/accounts/${id}`, { method: 'DELETE' }); toast.success('Deleted'); go('admin', { tab: 'profiles' }) } catch (e) { toast.error(e.message) }
  }

  if (!user || !user.isAdmin) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <Shield className="w-12 h-12 mx-auto text-[#c084fc] mb-4" /><h2 className="text-2xl font-bold mb-2">Admin Access Required</h2>
        <Button className="mt-4 bg-gradient-to-r from-[#c084fc] to-[#f472b6]" onClick={() => go('home')}>Go home</Button>
      </div>
    )
  }
  if (loading || !account || !form) return <div className="container mx-auto px-4 py-24 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-[#c084fc]" /></div>

  const profile = account.snapshot?.profile
  const limiteds = account.snapshot?.limiteds || []
  const items = account.snapshot?.items || []
  const gamepasses = account.snapshot?.gamepasses?.passes || []
  const totalRap = limiteds.reduce((s, it) => s + (Number(it.rap) || 0), 0)
  const listed = account.status === 'available'

  const StatChip = ({ label, value, color }) => (
    <div className="flex-1 min-w-[110px] px-4 py-3 rounded-lg" style={{ background: 'rgba(107,33,168,0.12)', border: '1px solid rgba(107,33,168,0.25)' }}>
      <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--eth-muted)' }}>{label}</p>
      <p className="text-lg font-bold mt-0.5" style={{ color: color || 'var(--eth-ink)' }}>{value}</p>
    </div>
  )
  const FieldLabel = ({ children }) => <p className="text-[11px] font-semibold tracking-wide uppercase mb-1.5" style={{ color: 'var(--eth-muted)' }}>{children}</p>

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <button onClick={() => go('admin', { tab: 'profiles' })} className="flex items-center gap-1 text-sm mb-6 transition-colors" style={{ color: 'var(--eth-muted)' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--eth-ink)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--eth-muted)'}><ChevronLeft className="w-4 h-4" /> Back to Imported Accounts</button>

      {profile && (
        <Card className="p-6 mb-6" style={{ background: 'var(--eth-night1)', borderColor: 'var(--eth-gold-dim)' }}>
          <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
            <img src={profile.avatarUrl || profile.headshotUrl} className="w-24 h-24 rounded-2xl object-cover shrink-0" style={{ background: 'rgba(107,33,168,0.15)' }} alt="" />
            <div className="flex-1 text-center sm:text-left min-w-0">
              <div className="flex items-center gap-2 justify-center sm:justify-start flex-wrap">
                <h1 className="text-2xl font-bold" style={{ color: 'var(--eth-ink)' }}>{profile.displayName}</h1>
                {profile.hasVerifiedBadge && <BadgeCheck className="w-5 h-5 text-blue-400" />}
                {profile.isBanned && <Badge className="bg-red-500/15 text-red-300 border-red-500/30">Banned</Badge>}
                <Badge className={listed ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}>{listed ? 'Listed for sale' : 'Draft'}</Badge>
              </div>
              <p className="text-sm mt-0.5" style={{ color: 'var(--eth-muted)' }}>@{profile.name} · ID {profile.id}</p>
              <p className="text-xs mt-1 flex items-center gap-1 justify-center sm:justify-start" style={{ color: 'var(--eth-muted)' }}><Calendar className="w-3 h-3" /> Joined {new Date(profile.created).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5 mt-5">
            <StatChip label="Total RAP" value={totalRap.toLocaleString()} color="var(--eth-teal)" />
            <StatChip label="Limiteds" value={limiteds.length} />
            <StatChip label="Items" value={items.length} />
            <StatChip label="Game Passes" value={gamepasses.length} />
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ProfileInventoryTabs limiteds={limiteds} items={items} gamepasses={gamepasses} />
        </div>

        <Card className="p-5 h-fit" style={{ background: 'var(--eth-night1)', borderColor: 'var(--eth-gold-dim)' }}>
          <h3 className="font-bold flex items-center gap-2 mb-4" style={{ color: 'var(--eth-ink)' }}><Tag className="w-4 h-4" style={{ color: 'var(--eth-gold)' }} /> List for sale</h3>

          <div className="space-y-3">
            <div><FieldLabel>Title</FieldLabel><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. OG 2015 Account" className="bg-black/30 border-white/10" /></div>
            <div><FieldLabel>Description</FieldLabel><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional" className="bg-black/30 border-white/10" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>Price (USD)</FieldLabel><Input value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="0.00" type="number" className="bg-black/30 border-white/10" /></div>
              <div><FieldLabel>Image URL</FieldLabel><Input value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} placeholder="Defaults to avatar" className="bg-black/30 border-white/10" /></div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t space-y-3" style={{ borderColor: 'rgba(107,33,168,0.3)' }}>
            <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--eth-muted)' }}><Lock className="w-3.5 h-3.5" /> Login credentials — delivered on /claim</p>
            <div className="p-3 rounded-lg space-y-3" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(107,33,168,0.2)' }}>
              <div className="grid grid-cols-2 gap-3">
                <div><FieldLabel>Username</FieldLabel><Input value={form.credentials.username} onChange={e => setForm({ ...form, credentials: { ...form.credentials, username: e.target.value } })} placeholder="Roblox username" className="bg-black/30 border-white/10" /></div>
                <div><FieldLabel>Password</FieldLabel><Input value={form.credentials.password} onChange={e => setForm({ ...form, credentials: { ...form.credentials, password: e.target.value } })} placeholder="Password" className="bg-black/30 border-white/10" /></div>
              </div>
              <div><FieldLabel>Email</FieldLabel><Input value={form.credentials.email} onChange={e => setForm({ ...form, credentials: { ...form.credentials, email: e.target.value } })} placeholder="Optional" className="bg-black/30 border-white/10" /></div>
              <div><FieldLabel>Notes</FieldLabel><Textarea value={form.credentials.notes} onChange={e => setForm({ ...form, credentials: { ...form.credentials, notes: e.target.value } })} placeholder="Recovery info, optional" className="bg-black/30 border-white/10" /></div>
            </div>
          </div>

          <div className="flex flex-col gap-2 mt-5 pt-4 border-t" style={{ borderColor: 'rgba(107,33,168,0.3)' }}>
            {listed
              ? <Button disabled={saving} onClick={() => save({ status: 'draft' })} variant="outline" className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10">Unlist</Button>
              : <Button disabled={saving} onClick={() => save({ status: 'available' })} className="font-semibold border-0" style={{ background: 'linear-gradient(90deg, var(--eth-gold), var(--eth-lavender))', color: 'var(--eth-night1)' }}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'List for sale'}</Button>}
            <Button disabled={saving} onClick={() => save()} variant="outline" className="border-white/10">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save draft'}</Button>
            <Button disabled={saving} onClick={remove} variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10"><Trash2 className="w-4 h-4 mr-1" /> Delete account</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function ImportListingDialog({ open, setOpen, api, vendors, onCreated }) {
  const empty = { name: '', description: '', imageUrl: '', category: 'Limiteds', rap: '', robuxPrice: '', assetId: '', collectibleItemId: '', stock: '1', price: '', condition: 'Limited', vendorId: '', durationDays: '30' }
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(empty)
  const [loading, setLoading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const reset = () => { setUrl(''); setShowForm(false); setForm(empty) }
  const close = (v) => { setOpen(v); if (!v) reset() }

  const doFetch = async () => {
    if (!url) { toast.error('Paste a Roblox item link'); return }
    setFetching(true)
    try {
      const d = await api('/admin/roblox-lookup', { method: 'POST', body: JSON.stringify({ url }) })
      const it = d.item
      setForm(f => ({
        ...f,
        name: it.name || '', description: it.description || '', imageUrl: it.imageUrl || '',
        rap: it.rap != null ? String(it.rap) : '', robuxPrice: it.lowestResalePrice != null ? String(it.lowestResalePrice) : '',
        assetId: it.assetId ? String(it.assetId) : '', collectibleItemId: it.collectibleItemId || ''
      }))
      setShowForm(true)
      toast.success('Auto-detected! Review the details and set your price.')
    } catch (e) {
      toast.error(`${e.message}. Fill the details manually.`)
      set('assetId', String((url.match(/\/(\d+)/) || [])[1] || ''))
      setShowForm(true)
    } finally { setFetching(false) }
  }

  const publish = async () => {
    if (!form.name) { toast.error('Item name is required'); return }
    if (!form.price) { toast.error('Set a USD price'); return }
    setLoading(true)
    try {
      await api('/admin/listings', { method: 'POST', body: JSON.stringify({
        name: form.name, description: form.description, imageUrl: form.imageUrl || undefined, category: form.category,
        robloxAssetId: form.assetId ? Number(form.assetId) : null, rap: form.rap ? Number(form.rap) : null,
        robuxPrice: form.robuxPrice ? Number(form.robuxPrice) : null, collectibleItemId: form.collectibleItemId || null,
        stock: form.stock, price: form.price, condition: form.condition, vendorId: form.vendorId || undefined, durationDays: form.durationDays
      }) })
      close(false); onCreated()
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }

  const inp = "bg-black/30 border-white/10 mt-1"
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="bg-[#12101f] border-white/10 text-slate-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Gem className="w-5 h-5 text-[#f472b6]" /> Import Roblox Item</DialogTitle><DialogDescription className="text-slate-400">Paste a Roblox link to auto-fill the name, description & image. Edit anything, then set your own price.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-slate-300">Roblox item link</Label>
            <div className="flex gap-2 mt-1">
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.roblox.com/catalog/1028606/..." className="bg-black/30 border-white/10" onKeyDown={e => e.key === 'Enter' && doFetch()} />
              <Button onClick={doFetch} disabled={fetching} className="bg-[#c084fc] shrink-0">{fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Detect'}</Button>
            </div>
            {!showForm && <button onClick={() => setShowForm(true)} className="text-xs text-slate-400 hover:text-[#c084fc] mt-2">or enter details manually</button>}
          </div>

          {showForm && (
            <div className="space-y-4 pt-1 border-t border-[#6b21a8]/40">
              <div className="flex gap-3">
                <div className="w-24 h-24 rounded-lg overflow-hidden bg-white/5 shrink-0 flex items-center justify-center">
                  {form.imageUrl ? <img src={form.imageUrl} className="w-full h-full object-cover" alt="" /> : <Package className="w-7 h-7 text-slate-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <Label className="text-slate-300">Image URL {form.assetId && <span className="text-emerald-400 text-[10px]">(from Roblox)</span>}</Label>
                  <Input value={form.imageUrl} onChange={e => set('imageUrl', e.target.value)} placeholder="Roblox image URL" className={inp} />
                  {form.assetId && <p className="text-[10px] text-slate-500 mt-1">Asset #{form.assetId}</p>}
                </div>
              </div>
              <div><Label className="text-slate-300">Name</Label><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Item name" className={inp} /></div>
              <div><Label className="text-slate-300">Description</Label><Textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="Item description" className={inp} rows={3} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-slate-300">RAP (Robux)</Label><Input type="number" value={form.rap} onChange={e => set('rap', e.target.value)} placeholder="auto" className={inp} /></div>
                <div><Label className="text-slate-300">Robux value</Label><Input type="number" value={form.robuxPrice} onChange={e => set('robuxPrice', e.target.value)} placeholder="auto" className={inp} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-slate-300">Category</Label><Select value={form.category} onValueChange={v => set('category', v)}><SelectTrigger className={inp}><SelectValue /></SelectTrigger><SelectContent className="bg-[#12101f] border-white/10 text-slate-100">{CATEGORIES.filter(c => c !== 'All').map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
                <div><Label className="text-slate-300">Condition</Label><Select value={form.condition} onValueChange={v => set('condition', v)}><SelectTrigger className={inp}><SelectValue /></SelectTrigger><SelectContent className="bg-[#12101f] border-white/10 text-slate-100">{['Limited', 'Rare', 'Mint', 'New', 'Clean'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-slate-300">Stock (qty)</Label><Input type="number" min="1" value={form.stock} onChange={e => set('stock', e.target.value)} className={inp} /></div>
                <div><Label className="text-emerald-300">Your Price (USD) *</Label><Input type="number" value={form.price} onChange={e => set('price', e.target.value)} placeholder="Set manually" className="bg-black/30 border-emerald-500/30 mt-1" /></div>
              </div>
              <div><Label className="text-slate-300">Store (optional)</Label><Select value={form.vendorId} onValueChange={v => set('vendorId', v)}><SelectTrigger className={inp}><SelectValue placeholder="Ethereal Market (default)" /></SelectTrigger><SelectContent className="bg-[#12101f] border-white/10 text-slate-100">{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
          )}
        </div>
        <DialogFooter><Button disabled={loading || !showForm} onClick={publish} className="w-full bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'List on Marketplace'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditStockDialog({ listing, setListing, api, onSaved }) {
  const [stock, setStock] = useState('')
  const [price, setPrice] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => { if (listing) { setStock(String(listing.stock ?? '')); setPrice(String(listing.price ?? '')) } }, [listing])
  const save = async () => {
    setLoading(true)
    try { await api(`/admin/listings/${listing.id}`, { method: 'PUT', body: JSON.stringify({ stock, price }) }); setListing(null); onSaved() }
    catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }
  return (
    <Dialog open={!!listing} onOpenChange={v => !v && setListing(null)}>
      <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Package className="w-5 h-5 text-[#c084fc]" /> Edit Listing</DialogTitle><DialogDescription className="text-slate-400">{listing?.item?.name}. Set stock to 0 to mark sold out, or add stock to relist.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-slate-300">Stock (qty)</Label><Input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} className="bg-black/30 border-white/10 mt-1" /></div>
          <div><Label className="text-slate-300">Price (USD)</Label><Input type="number" value={price} onChange={e => setPrice(e.target.value)} className="bg-black/30 border-white/10 mt-1" /></div>
        </div>
        <DialogFooter><Button disabled={loading} onClick={save} className="w-full bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateVendorDialog({ open, setOpen, api, onCreated }) {
  const [form, setForm] = useState({ name: '', reputation: '5' })
  const [loading, setLoading] = useState(false)
  const submit = async () => { if (!form.name) { toast.error('Name required'); return } setLoading(true); try { await api('/admin/vendors', { method: 'POST', body: JSON.stringify({ name: form.name, reputation: parseFloat(form.reputation) }) }); setOpen(false); setForm({ name: '', reputation: '5' }); onCreated() } catch (e) { toast.error(e.message) } finally { setLoading(false) } }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Store className="w-5 h-5 text-[#c084fc]" /> New Store / Vendor</DialogTitle><DialogDescription className="text-slate-400">Stores are the sellers shown on listings.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-slate-300">Store name</Label><Input className="bg-black/30 border-white/10 mt-1" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="PixelKing" /></div>
          <div><Label className="text-slate-300">Reputation (1-5)</Label><Input type="number" step="0.1" min="1" max="5" className="bg-black/30 border-white/10 mt-1" value={form.reputation} onChange={e => setForm({ ...form, reputation: e.target.value })} /></div>
        </div>
        <DialogFooter><Button disabled={loading} onClick={submit} className="w-full bg-gradient-to-r from-[#c084fc] to-[#f472b6] font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Store'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdminChatPanel({ api }) {
  const [threads, setThreads] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)

  const loadThreads = useCallback(async () => { try { const d = await api('/admin/chat/threads'); setThreads(d.threads || []) } catch {} }, [api])
  useEffect(() => { loadThreads(); const iv = setInterval(loadThreads, 6000); return () => clearInterval(iv) }, [loadThreads])

  const loadMessages = useCallback(async (id) => { try { const d = await api(`/admin/chat/threads/${id}/messages`); setMessages(d.messages || []) } catch {} }, [api])
  useEffect(() => {
    if (!selected) return
    loadMessages(selected)
    const iv = setInterval(() => loadMessages(selected), 4000)
    return () => clearInterval(iv)
  }, [selected, loadMessages])

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages])

  const sendReply = async () => {
    const text = reply.trim()
    if (!text || !selected || sending) return
    setSending(true)
    try {
      const d = await api(`/admin/chat/threads/${selected}/reply`, { method: 'POST', body: JSON.stringify({ text }) })
      setMessages(prev => [...prev, d.message])
      setReply('')
      loadThreads()
    } catch (e) { toast.error(e.message) } finally { setSending(false) }
  }

  return (
    <div className="grid grid-rows-[220px_1fr] md:grid-rows-none md:grid-cols-[280px_1fr] gap-4 h-[70vh] md:h-[560px]">
      <div className="border overflow-y-auto" style={{ borderColor: 'var(--eth-gold-dim)', background: 'rgba(20,10,36,0.5)' }}>
        {threads.length === 0 && <p className="text-sm p-4" style={{ color: 'var(--eth-muted)' }}>No conversations yet.</p>}
        {threads.map(t => (
          <button key={t.id} onClick={() => setSelected(t.id)} className="w-full text-left px-3 py-3 border-b flex items-start gap-2"
            style={{ borderColor: 'rgba(107,33,168,0.2)', background: selected === t.id ? 'rgba(192,132,252,0.1)' : 'transparent' }}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate flex items-center gap-1.5" style={{ color: 'var(--eth-ink)' }}>
                {t.buyerName || 'Guest'}
                {t.unreadForAdmin && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--eth-muted)' }}>{t.lastMessage || 'No messages yet'}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="border flex flex-col" style={{ borderColor: 'var(--eth-gold-dim)', background: 'rgba(20,10,36,0.5)' }}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--eth-muted)' }}>Select a conversation</div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.sender === 'staff' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[75%] px-3 py-2 text-sm leading-relaxed" style={m.sender === 'staff'
                    ? { background: 'linear-gradient(90deg, var(--eth-gold), var(--eth-lavender))', color: 'var(--eth-night1)' }
                    : { background: 'rgba(192,132,252,0.12)', border: '1px solid rgba(192,132,252,0.3)', color: 'var(--eth-ink)' }}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t flex items-center gap-2" style={{ borderColor: 'rgba(107,33,168,0.3)' }}>
              <Input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendReply()} placeholder="Reply to buyer..." className="bg-black/30 border-white/10" />
              <Button disabled={sending || !reply.trim()} onClick={sendReply} className="rounded-none font-semibold shrink-0" style={{ background: 'linear-gradient(90deg, var(--eth-gold), var(--eth-lavender))', color: 'var(--eth-night1)' }}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

