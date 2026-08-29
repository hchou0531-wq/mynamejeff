'use client'

import { useState, useEffect, useCallback } from 'react'
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
import {
  Search, ShoppingCart, Store, Star, Sparkles, Heart, Bell, Plus, LayoutGrid,
  Shield, TrendingUp, Clock, Tag, ChevronLeft, LogOut, User, CheckCircle2, Flag, Loader2, Gem, Package, Zap, Bitcoin, Trash2, Gamepad2, Info, BadgeCheck, Calendar, Coins,
  AlertTriangle, ExternalLink, Crown, ShieldCheck, Lock
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer } from 'recharts'

const ROBUX_RATE = 80
const CATEGORIES = ['All', 'Limiteds', 'Accessories', 'UGC', 'Collectibles', 'Gear', 'Faces', 'Bundles']
const CAT_ICONS = { Limiteds: Gem, Accessories: Sparkles, UGC: Package, Collectibles: Star, Gear: Zap, Faces: User, Bundles: LayoutGrid }
const CONDITIONS = ['All', 'Mint', 'Rare', 'New', 'Used']
const rbx = (u) => Math.round(u * ROBUX_RATE).toLocaleString()
const usd = (n) => `$${Number(n).toFixed(2)}`

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
    if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`)
    return data
  }, [])
}

function PriceTag({ price, size = 'md' }) {
  return (
    <div className="flex flex-col">
      <span className={`font-extrabold text-emerald-400 ${size === 'lg' ? 'text-2xl' : 'text-lg'}`}>{usd(price)}</span>
      <span className="text-[11px] text-violet-300/80 font-semibold">{rbx(price)} R$</span>
    </div>
  )
}

function ItemCard({ listing, onOpen }) {
  const sold = listing.status && listing.status !== 'active'
  return (
    <Card onClick={() => onOpen(listing)} className="group relative overflow-hidden bg-[#12101f]/80 border-white/5 hover:border-violet-500/50 transition-all cursor-pointer hover:-translate-y-1 hover:shadow-[0_10px_40px_-10px_rgba(139,92,246,0.5)]">
      <div className="relative aspect-square overflow-hidden bg-black/40">
        <img src={listing.item.imageUrl} alt={listing.item.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
        <Badge className="absolute top-2 left-2 bg-black/70 backdrop-blur text-violet-200 border-violet-500/40">{listing.item.category}</Badge>
        <Badge className="absolute top-2 right-2 bg-emerald-500/20 text-emerald-300 border-emerald-500/40">{listing.condition}</Badge>
        {sold && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><Badge className="bg-red-500/90 text-white">SOLD</Badge></div>}
      </div>
      <div className="p-3 space-y-2">
        <h3 className="font-bold text-sm truncate text-slate-100">{listing.item.name}</h3>
        <div className="flex items-center justify-between">
          <PriceTag price={listing.price} />
          <div className="flex items-center gap-1 text-xs text-slate-400"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{(listing.sellerRep || 5).toFixed(1)}</div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400 truncate"><img src={listing.sellerAvatar} className="w-4 h-4 rounded-full bg-white/10" alt="" />{listing.sellerName}</div>
      </div>
    </Card>
  )
}

function Logo({ onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 group">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/30 rotate-3 group-hover:rotate-6 transition-transform"><Gem className="w-5 h-5 text-white" /></div>
      <span className="text-xl font-black tracking-tight bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent">Robloot</span>
    </button>
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

  const go = (name, params = {}) => { setView({ name, ...params }); window.scrollTo(0, 0) }
  const loadMe = useCallback(async () => { try { const d = await api('/me'); setUser(d.user); return d.user } catch { localStorage.removeItem('rbx_token'); setUser(null); return null } }, [api])
  const loadNotifs = useCallback(async () => { try { const d = await api('/notifications'); setNotifications(d.notifications || []) } catch {} }, [api])

  useEffect(() => {
    (async () => {
      api('/config').then(setCfg).catch(() => {})
      const t = localStorage.getItem('rbx_token')
      if (t) { const u = await loadMe(); if (u) await loadNotifs() }
      setBooting(false)
      // handle crypto redirect return
      const params = new URLSearchParams(window.location.search)
      const orderId = params.get('orderId')
      const pay = params.get('payment')
      if (orderId && pay) {
        window.history.replaceState({}, '', window.location.pathname)
        setView({ name: 'order', orderId })
      }
    })()
  }, [loadMe, loadNotifs, api])

  const requireAuth = (fn) => { if (!user) { setAuthMode('login'); setAuthOpen(true); toast.info('Please sign in to continue'); return } fn() }
  const logout = () => { localStorage.removeItem('rbx_token'); setUser(null); go('home'); toast.success('Signed out') }
  const unread = notifications.filter(n => !n.read).length

  return (
    <div className="min-h-screen bg-[#0a0912] text-slate-100">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-violet-600/10 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full bg-fuchsia-600/10 blur-[120px]" />
      </div>

      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#0a0912]/80 border-b border-white/5">
        <div className="container mx-auto px-4 h-16 flex items-center gap-4">
          <Logo onClick={() => go('browse')} />
          <nav className="hidden md:flex items-center gap-1 ml-2">
            <Button variant="ghost" className="text-slate-300 hover:text-white" onClick={() => go('browse')}>Browse</Button>
            <Button variant="ghost" className="text-slate-300 hover:text-white" onClick={() => go('browse', { category: 'Limiteds' })}>Limiteds</Button>
            {user?.isAdmin && <Button variant="ghost" className="text-fuchsia-300 hover:text-fuchsia-200" onClick={() => go('admin')}>Admin</Button>}
          </nav>
          <div className="flex-1" />
          {booting ? null : user ? (
            <div className="flex items-center gap-2">
              <Badge className="hidden sm:flex bg-amber-500/10 text-amber-300 border-amber-500/20 gap-1"><Bitcoin className="w-3.5 h-3.5" /> Crypto</Badge>
              <Button size="icon" variant="ghost" className="relative text-slate-300" onClick={async () => { setNotifOpen(true); await api('/notifications/read', { method: 'POST' }); setNotifications(n => n.map(x => ({ ...x, read: true }))) }}>
                <Bell className="w-5 h-5" />
                {unread > 0 && <span className="absolute top-1 right-1 w-4 h-4 text-[10px] rounded-full bg-fuchsia-500 flex items-center justify-center font-bold">{unread}</span>}
              </Button>
              <button onClick={() => go('dashboard')} className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full hover:bg-white/5 border border-white/5">
                <Avatar className="w-8 h-8"><AvatarImage src={user.avatarUrl} /><AvatarFallback>{user.username[0]}</AvatarFallback></Avatar>
                <span className="text-sm font-semibold hidden sm:block">{user.username}</span>
              </button>
              <Button size="icon" variant="ghost" className="text-slate-400" onClick={logout}><LogOut className="w-4 h-4" /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" className="text-slate-200" onClick={() => { setAuthMode('login'); setAuthOpen(true) }}>Login</Button>
              <Button className="bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-400 hover:to-fuchsia-500 font-semibold" onClick={() => { setAuthMode('signup'); setAuthOpen(true) }}>Sign Up</Button>
            </div>
          )}
        </div>
      </header>

      <main className="relative z-10">
        {view.name === 'browse' && <BrowseView api={api} go={go} initialCategory={view.category} initialSearch={view.search} />}
        {view.name === 'item' && <ItemView api={api} go={go} listingId={view.listingId} user={user} requireAuth={requireAuth} cfg={cfg} />}
        {view.name === 'order' && <OrderStatusView api={api} go={go} orderId={view.orderId} refreshNotifs={loadNotifs} cfg={cfg} />}
        {view.name === 'seller' && <SellerView api={api} go={go} name={view.username} />}
        {view.name === 'dashboard' && (user ? <DashboardView api={api} go={go} user={user} /> : <EmptyAuth onLogin={() => { setAuthMode('login'); setAuthOpen(true) }} />)}
        {view.name === 'admin' && <AdminView api={api} user={user} go={go} cfg={cfg} />}
      </main>

      <footer className="relative z-10 border-t border-white/5 mt-20 py-10">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <Logo onClick={() => go('browse')} />
          <p className="text-center max-w-xl">An original marketplace demo. Not affiliated with or endorsed by Roblox Corporation. Payments are processed in cryptocurrency via CoinGate.</p>
          <span className="flex items-center gap-1"><Bitcoin className="w-3.5 h-3.5" /> Crypto payments</span>
        </div>
      </footer>

      <AuthDialog open={authOpen} setOpen={setAuthOpen} mode={authMode} setMode={setAuthMode} api={api} onAuthed={async (u) => { setUser(u); setAuthOpen(false); await loadNotifs(); toast.success(`Welcome, ${u.username}!`); if (u.isAdmin) go('admin') }} />
      <NotifDialog open={notifOpen} setOpen={setNotifOpen} notifications={notifications} />
    </div>
  )
}

function AuthDialog({ open, setOpen, mode, setMode, api, onAuthed }) {
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    setLoading(true)
    try {
      const path = mode === 'signup' ? '/auth/signup' : '/auth/login'
      const body = mode === 'signup' ? form : { email: form.email, password: form.password }
      const d = await api(path, { method: 'POST', body: JSON.stringify(body) })
      localStorage.setItem('rbx_token', d.token); onAuthed(d.user)
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
        <DialogHeader><DialogTitle className="text-2xl font-black">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</DialogTitle>
          <DialogDescription className="text-slate-400">{mode === 'signup' ? 'Join to buy items and pay with crypto.' : 'Sign in to shop the marketplace.'}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {mode === 'signup' && <div><Label className="text-slate-300">Username</Label><Input className="bg-black/30 border-white/10 mt-1" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="coolgamer99" /></div>}
          <div><Label className="text-slate-300">Email</Label><Input className="bg-black/30 border-white/10 mt-1" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></div>
          <div><Label className="text-slate-300">Password</Label><Input type="password" className="bg-black/30 border-white/10 mt-1" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="********" onKeyDown={e => e.key === 'Enter' && submit()} /></div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={loading} onClick={submit} className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-600 font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (mode === 'signup' ? 'Create Account' : 'Sign In')}</Button>
          <button className="text-sm text-slate-400 hover:text-violet-300" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
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
            <div key={n.id} className="p-3 rounded-lg bg-black/30 border border-white/5 flex items-start gap-2">
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
      <User className="w-12 h-12 mx-auto text-violet-400 mb-4" />
      <h2 className="text-2xl font-bold mb-2">Sign in to view your dashboard</h2>
      <Button onClick={onLogin} className="mt-4 bg-gradient-to-r from-violet-500 to-fuchsia-600">Sign In</Button>
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
            <Badge className="mb-5 bg-violet-500/15 text-violet-200 border-violet-500/30 px-4 py-1.5 text-sm"><Sparkles className="w-3.5 h-3.5 mr-1.5" /> The marketplace for Roblox collectors</Badge>
            <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-5 leading-[1.05]">Discover items.<br />Find deals.<br /><span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">Pay with crypto.</span></h1>
            <p className="text-lg text-slate-400 mb-8 max-w-xl mx-auto">Buy limiteds, UGC, accessories and collectibles. Prices in USD & Robux, checkout in Bitcoin, Ethereum, USDT & more.</p>
            <div className="flex gap-2 max-w-xl mx-auto">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <Input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && go('browse', { search })} placeholder="Search for an item..." className="pl-12 h-14 bg-[#12101f]/90 border-white/10 text-base rounded-xl" />
              </div>
              <Button onClick={() => go('browse', { search })} className="h-14 px-8 bg-gradient-to-r from-violet-500 to-fuchsia-600 font-bold text-base rounded-xl">Search</Button>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black flex items-center gap-2"><TrendingUp className="w-6 h-6 text-fuchsia-400" /> Trending</h2>
          <Button variant="ghost" className="text-violet-300" onClick={() => go('browse')}>View all</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {trending.length === 0 ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="aspect-[3/4] rounded-xl bg-white/5 animate-pulse" />) : trending.slice(0, 5).map(l => <ItemCard key={l.id} listing={l} onOpen={() => go('item', { listingId: l.id })} />)}
        </div>
      </section>

      <section className="container mx-auto px-4 py-8">
        <h2 className="text-2xl font-black mb-6 flex items-center gap-2"><LayoutGrid className="w-6 h-6 text-violet-400" /> Popular Categories</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {CATEGORIES.filter(c => c !== 'All').map(cat => {
            const Icon = CAT_ICONS[cat] || Tag
            return (
              <button key={cat} onClick={() => go('browse', { category: cat })} className="group p-6 rounded-2xl bg-gradient-to-br from-[#15121f] to-[#0f0d18] border border-white/5 hover:border-violet-500/40 transition-all hover:-translate-y-1">
                <Icon className="w-8 h-8 mb-3 text-violet-400 group-hover:text-fuchsia-400 transition-colors" /><p className="font-bold">{cat}</p>
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
            <Card key={i} className="p-6 bg-[#12101f]/60 border-white/5">
              <div className="w-11 h-11 rounded-xl bg-violet-500/15 flex items-center justify-center mb-4"><Icon className="w-5 h-5 text-violet-300" /></div>
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
  return (
    <Card onClick={() => onOpen(listing)} className="group relative overflow-hidden bg-[#0e0d16] border border-white/[0.06] rounded-2xl hover:border-violet-500/40 hover:shadow-[0_8px_30px_-12px_rgba(139,92,246,0.45)] transition-all cursor-pointer">
      <div className="absolute top-3 right-3 z-10 w-7 h-7 rounded-lg bg-black/60 backdrop-blur flex items-center justify-center border border-white/10" title="Crypto accepted"><Bitcoin className="w-3.5 h-3.5 text-amber-400" /></div>
      {typeof listing.stock === 'number' && listing.status === 'active' && <div className="absolute top-3 left-3 z-10 text-[10px] font-bold px-2 py-0.5 rounded-md bg-black/60 backdrop-blur border border-white/10 text-slate-300">{listing.stock} left</div>}
      <div className="p-4 pb-2">
        <div className="aspect-square rounded-xl overflow-hidden bg-gradient-to-b from-white/[0.04] to-transparent">
          <img src={listing.item.imageUrl} alt={listing.item.name} className="w-full h-full object-cover group-hover:scale-[1.06] transition-transform duration-500" />
        </div>
      </div>
      <div className="px-4 pb-4">
        <p className="font-semibold text-sm text-center truncate mb-3">{listing.item.name}</p>
        <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
          <div><p className="text-[10px] uppercase tracking-widest text-slate-500">RAP</p><p className="text-sm font-bold text-slate-300">{listing.rap != null ? Number(listing.rap).toLocaleString() : '—'}</p></div>
          <div className="text-right"><p className="text-[10px] uppercase tracking-widest text-slate-500">From</p><p className="text-sm font-black text-emerald-400">{usd(listing.price)}</p></div>
        </div>
      </div>
      {sold && <div className="absolute inset-0 bg-black/65 flex items-center justify-center"><Badge className="bg-red-500/90 text-white">SOLD</Badge></div>}
    </Card>
  )
}

function SoldStripCard({ listing }) {
  return (
    <div className="relative shrink-0 w-36 rounded-xl bg-[#0e0d16] border border-white/[0.06] p-3">
      <span className="absolute top-2 left-2 z-10 text-[11px] font-black text-emerald-400 bg-black/70 px-2 py-0.5 rounded-md border border-white/5">{usd(listing.price)}</span>
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
            <div>
              <h2 className="text-lg font-black mb-3">Market</h2>
              <div className="space-y-0.5">
                {CATEGORIES.map(c => (
                  <button key={c} onClick={() => setCategory(c)} className={`block w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${category === c ? 'bg-violet-500/15 text-violet-300' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>{c === 'All' ? 'All Items' : c}</button>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Filters</h3>
              <div>
                <p className="text-xs text-slate-400 mb-1.5">Price (USD)</p>
                <div className="flex items-center gap-2">
                  <Input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="Min" className="bg-[#0e0d16] border-white/10 h-9" />
                  <span className="text-slate-600">-</span>
                  <Input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Max" className="bg-[#0e0d16] border-white/10 h-9" />
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1.5">Condition</p>
                <Select value={condition} onValueChange={setCondition}><SelectTrigger className="bg-[#0e0d16] border-white/10 h-9"><SelectValue /></SelectTrigger><SelectContent className="bg-[#12101f] border-white/10 text-slate-100">{CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1.5">Sort by</p>
                <Select value={sort} onValueChange={setSort}><SelectTrigger className="bg-[#0e0d16] border-white/10 h-9"><SelectValue /></SelectTrigger><SelectContent className="bg-[#12101f] border-white/10 text-slate-100"><SelectItem value="newest">Newest</SelectItem><SelectItem value="popular">Most Popular</SelectItem><SelectItem value="price_asc">Price: Low to High</SelectItem><SelectItem value="price_desc">Price: High to Low</SelectItem></SelectContent></Select>
              </div>
              <Button variant="outline" onClick={reset} className="w-full border-white/10 text-slate-300 hover:text-white">Reset Filters</Button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0 space-y-10">
          {/* Recently Sold */}
          {sold.length > 0 && (
            <section>
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-3">Recently Sold</h2>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">{sold.map(l => <SoldStripCard key={l.id} listing={l} />)}</div>
            </section>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the marketplace..." className="pl-12 h-12 bg-[#0e0d16] border-white/10 rounded-xl text-base" />
          </div>

          {/* Trending */}
          {trending.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-black flex items-center gap-2"><TrendingUp className="w-5 h-5 text-fuchsia-400" /> Trending Right Now</h2></div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">{trending.slice(0, 5).map(l => <MarketCard key={l.id} listing={l} onOpen={() => go('item', { listingId: l.id })} />)}</div>
            </section>
          )}

          {/* All Listings */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xl font-black">All Listings</h2>
              <span className="text-slate-500 text-sm">{listings.length} items</span>
            </div>
            {loading ? <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[4/5] rounded-2xl bg-white/[0.03] animate-pulse" />)}</div>
              : listings.length === 0 ? <div className="py-24 text-center text-slate-400"><Package className="w-12 h-12 mx-auto mb-3 opacity-40" />No items match your filters.</div>
              : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{listings.map(l => <MarketCard key={l.id} listing={l} onOpen={() => go('item', { listingId: l.id })} />)}</div>}
          </section>
        </div>
      </div>
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

  if (!data) return <div className="container mx-auto px-4 py-32 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-violet-400" /></div>
  const { listing, seller } = data
  const sold = listing.status !== 'active'
  return (
    <div className="container mx-auto px-4 py-8">
      <Button variant="ghost" className="mb-6 text-slate-400" onClick={() => go('browse')}><ChevronLeft className="w-4 h-4 mr-1" /> Back to marketplace</Button>
      <div className="grid md:grid-cols-2 gap-8">
        <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/40">
          <img src={listing.item.imageUrl} alt={listing.item.name} className="w-full aspect-square object-cover" />
          <Badge className="absolute top-4 left-4 bg-black/70 text-violet-200 border-violet-500/40">{listing.item.category}</Badge>
          {sold && <div className="absolute inset-0 bg-black/70 flex items-center justify-center"><Badge className="bg-red-500/90 text-white text-lg px-6 py-2">SOLD</Badge></div>}
        </div>
        <div className="space-y-5">
          <div>
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-3xl font-black">{listing.item.name}</h1>
              <Button size="icon" variant="ghost" className="text-slate-400 hover:text-pink-400" onClick={toggleWish}><Heart className="w-5 h-5" /></Button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">{listing.condition}</Badge>
              <span className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Expires {new Date(listing.expiresAt).toLocaleDateString()}</span>
              <span className="text-xs text-slate-500 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {listing.popularity} views</span>
            </div>
          </div>
          <p className="text-slate-400">{listing.item.description}</p>
          <Card className="p-5 bg-[#12101f]/60 border-white/5">
            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <div className="rounded-lg bg-black/30 py-2"><p className="text-[10px] uppercase tracking-widest text-slate-500">RAP</p><p className="text-sm font-bold text-violet-300">{listing.rap != null ? Number(listing.rap).toLocaleString() : '—'}</p></div>
              <div className="rounded-lg bg-black/30 py-2"><p className="text-[10px] uppercase tracking-widest text-slate-500">Robux</p><p className="text-sm font-bold text-slate-300">{listing.robuxPrice != null ? Number(listing.robuxPrice).toLocaleString() : '—'}</p></div>
              <div className="rounded-lg bg-black/30 py-2"><p className="text-[10px] uppercase tracking-widest text-slate-500">Stock</p><p className="text-sm font-bold text-emerald-300">{typeof listing.stock === 'number' ? listing.stock : '—'}</p></div>
            </div>
            <div className="flex items-end justify-between mb-4">
              <PriceTag price={listing.price} size="lg" />
              <div className="text-right text-xs text-slate-500">Roblox Asset ID<br /><span className="text-slate-300 font-mono">{listing.robloxAssetId || listing.item.robloxItemId || 'N/A'}</span></div>
            </div>
            {sold ? <Button disabled className="w-full" variant="secondary">Sold out</Button>
              : <Button onClick={() => requireAuth(openCheckout)} className="w-full h-12 text-base bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 font-bold"><Bitcoin className="w-5 h-5 mr-2" /> Buy with Crypto</Button>}
            <p className="text-xs text-slate-500 mt-2 text-center flex items-center justify-center gap-1"><Shield className="w-3 h-3" /> Secure crypto checkout {cfg?.receiveCurrency ? `· settles in ${cfg.receiveCurrency}` : ''}</p>
          </Card>
          <button onClick={() => go('seller', { username: listing.sellerName })} className="w-full flex items-center gap-3 p-4 rounded-xl bg-[#12101f]/60 border border-white/5 hover:border-violet-500/40 transition-colors text-left">
            <img src={listing.sellerAvatar} className="w-12 h-12 rounded-full bg-white/10" alt="" />
            <div className="flex-1"><div className="flex items-center gap-2"><p className="font-bold">{listing.sellerName}</p><CheckCircle2 className="w-4 h-4 text-emerald-400" /></div>
              <div className="flex items-center gap-3 text-xs text-slate-400"><span className="flex items-center gap-1"><Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {(listing.sellerRep || 5).toFixed(1)} rating</span><span>{seller?.salesCount || 0} sales</span></div></div>
            <span className="text-violet-300 text-sm">View store</span>
          </button>
          <button onClick={() => requireAuth(() => setReportOpen(true))} className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1"><Flag className="w-3 h-3" /> Report this listing</button>
        </div>
      </div>

      {related.length > 0 && <div className="mt-16"><h2 className="text-xl font-black mb-5">More in {listing.item.category}</h2><div className="grid grid-cols-2 sm:grid-cols-4 gap-4">{related.map(l => <ItemCard key={l.id} listing={l} onOpen={() => go('item', { listingId: l.id })} />)}</div></div>}

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
                <Button disabled={verifying} onClick={verifyAccount} className="bg-gradient-to-r from-violet-500 to-fuchsia-600 font-bold">{verifying ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Looking up...</> : 'Verify Roblox account'}</Button>
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
                <a href={`https://www.roblox.com/users/${rbxProfile.id}/profile`} target="_blank" rel="noreferrer" className="text-xs text-violet-300 hover:underline mt-1 flex items-center gap-1">View profile <ExternalLink className="w-3 h-3" /></a>
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
                <div className="py-10 flex flex-col items-center text-slate-400"><Loader2 className="w-7 h-7 animate-spin text-violet-400 mb-3" /> Checking your Roblox account...</div>
              ) : (
                <div className="space-y-2.5">
                  {/* Premium */}
                  {elig.premiumChecked
                    ? <StatusRow ok={elig.premium} title={elig.premium ? 'Roblox Premium active' : 'No Roblox Premium detected'} desc={elig.premium ? "You have the Premium (Roblox+) mark." : 'Trading limiteds requires Roblox Premium. You can still continue, but delivery may not be possible without it.'} />
                    : <StatusRow ok={false} title="Couldn't verify Premium" desc="We couldn't confirm Premium right now. Make sure you have Roblox Premium so the item can be traded to you." />}
                  {/* Trades */}
                  {elig.tradesChecked
                    ? <StatusRow ok={elig.tradesEnabled} title={elig.tradesEnabled ? 'Trades are enabled' : 'Trades appear to be disabled'} desc={elig.tradesEnabled ? 'Your account can receive trades.' : 'We could not send you a trade.'}>
                        {!elig.tradesEnabled && <a href="https://www.roblox.com/my/account#!/privacy" target="_blank" rel="noreferrer" className="text-xs text-amber-300 hover:underline mt-1 inline-flex items-center gap-1">Enable trades: Settings → Privacy → “Who can trade with me” → Everyone <ExternalLink className="w-3 h-3" /></a>}
                      </StatusRow>
                    : <StatusRow ok={false} title="Make sure trades are enabled" desc="We couldn't verify your trade setting. Please enable trading so we can deliver the item.">
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
                      <p className="text-xs text-slate-500 p-3 rounded-lg bg-black/30 border border-white/5">No limiteds found on this account{elig.inventoryPublic === false ? ' (inventory is private)' : ''}.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                        {elig.limiteds.map(l => {
                          const over = (l.rap ?? 0) >= elig.rapLimit
                          const sel = giveItems.includes(l.assetId)
                          return (
                            <button key={l.assetId} onClick={() => toggleGive(l.assetId)} className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-colors ${sel ? 'border-violet-500 bg-violet-500/10' : 'border-white/10 bg-black/30 hover:border-white/20'}`}>
                              <img src={l.imageUrl} className="w-10 h-10 rounded-md object-cover bg-black/40 shrink-0" alt="" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{l.name}</p>
                                <p className={`text-[11px] flex items-center gap-1 ${over ? 'text-amber-400' : 'text-slate-400'}`}>RAP {l.rap != null ? Number(l.rap).toLocaleString() : '—'}{over && <span className="inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> over {Number(elig.rapLimit / 1000)}k</span>}</p>
                              </div>
                              {sel && <CheckCircle2 className="w-4 h-4 text-violet-400 shrink-0" />}
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
          <div className="space-y-2">{['Fraudulent / scam', 'Wrong or misleading item', 'Inappropriate content', 'Price manipulation'].map(r => <button key={r} onClick={() => submitReport(r)} className="w-full text-left p-3 rounded-lg bg-black/30 hover:bg-white/5 border border-white/5 text-sm">{r}</button>)}</div>
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

  if (!order) return <div className="container mx-auto px-4 py-32 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-violet-400" /></div>
  const paid = order.status === 'paid'
  const pending = order.status === 'pending_payment'
  return (
    <div className="container mx-auto px-4 py-16 max-w-lg text-center">
      <Card className="p-8 bg-[#12101f]/60 border-white/5">
        {order.item && <img src={order.item.imageUrl} className="w-24 h-24 rounded-xl object-cover mx-auto mb-4" alt="" />}
        {paid ? (
          <><div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-9 h-9 text-emerald-400" /></div>
            <h1 className="text-2xl font-black mb-1">Payment Confirmed!</h1><p className="text-slate-400 mb-6">You now own <span className="text-white font-semibold">{order.item?.name}</span>.</p>
            <Button onClick={() => go('dashboard')} className="bg-gradient-to-r from-violet-500 to-fuchsia-600 font-semibold">View my purchases</Button></>
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
            <Button onClick={() => go('browse')} className="bg-gradient-to-r from-violet-500 to-fuchsia-600">Back to marketplace</Button></>
        )}
      </Card>
    </div>
  )
}

function SellerView({ api, go, name }) {
  const [data, setData] = useState(null)
  useEffect(() => { api(`/users/${encodeURIComponent(name)}`).then(setData).catch(e => toast.error(e.message)) }, [api, name])
  if (!data) return <div className="container mx-auto px-4 py-32 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-violet-400" /></div>
  const { user, listings } = data
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="rounded-2xl overflow-hidden border border-white/5 mb-8">
        <div className="h-32 bg-gradient-to-r from-violet-600/40 via-fuchsia-600/30 to-pink-600/40" />
        <div className="px-6 pb-6 -mt-12 flex flex-col sm:flex-row sm:items-end gap-4 bg-[#12101f]/60">
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
      <h1 className="text-3xl font-black mb-6 flex items-center gap-2"><Store className="w-7 h-7 text-violet-400" /> Verified Stores</h1>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {vendors.map(s => (
          <button key={s.id} onClick={() => go('seller', { username: s.name })} className="flex items-center gap-4 p-5 rounded-2xl bg-[#12101f]/60 border border-white/5 hover:border-violet-500/40 transition-all hover:-translate-y-1 text-left">
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
      {!embedded && <h1 className="text-3xl font-black mb-2 flex items-center gap-2"><User className="w-7 h-7 text-violet-400" /> Roblox Profiles</h1>}
      <p className="text-slate-400 mb-5">Paste a Roblox profile link, username, or user ID to view their limiteds, items, game passes & account info.</p>
      <div className="flex gap-2 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && lookup()} placeholder="https://www.roblox.com/users/156/profile  ·  builderman  ·  156" className="pl-12 h-12 bg-[#0e0d16] border-white/10 rounded-xl" />
        </div>
        <Button onClick={lookup} disabled={loading} className="h-12 px-8 bg-gradient-to-r from-violet-500 to-fuchsia-600 font-bold rounded-xl">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Detect'}</Button>
      </div>

      {profile && (
        <div>
          {/* Header */}
          <Card className="p-6 bg-[#12101f]/60 border-white/5 mb-6 flex flex-col sm:flex-row gap-5 items-center sm:items-start">
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
            <TabsList className="bg-[#12101f] border border-white/5">
              <TabsTrigger value="items"><Gem className="w-4 h-4 mr-1" /> Items</TabsTrigger>
              <TabsTrigger value="gamepasses"><Gamepad2 className="w-4 h-4 mr-1" /> Game Passes</TabsTrigger>
              <TabsTrigger value="info"><Info className="w-4 h-4 mr-1" /> Account Info</TabsTrigger>
            </TabsList>

            <TabsContent value="items" className="mt-5">
              <Tabs defaultValue="limiteds">
                <TabsList className="bg-black/30 border border-white/5">
                  <TabsTrigger value="limiteds">Limiteds {limiteds?.limiteds ? `(${limiteds.limiteds.length})` : ''}</TabsTrigger>
                  <TabsTrigger value="regular">Regular {items?.items ? `(${items.items.length})` : ''}</TabsTrigger>
                </TabsList>
                <TabsContent value="limiteds" className="mt-4">
                  {!limiteds ? <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
                    : limiteds.limiteds.length === 0 ? <Empty text={limiteds.private ? 'This account has no public limiteds (or inventory is private).' : 'No limiteds found.'} />
                    : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                        {limiteds.limiteds.map(it => (
                          <Card key={it.assetId} className="overflow-hidden bg-[#0e0d16] border-white/5">
                            <div className="aspect-square bg-white/[0.03]"><img src={it.imageUrl} className="w-full h-full object-cover" alt="" /></div>
                            <div className="p-3"><p className="text-sm font-semibold truncate">{it.name}</p>
                              <div className="flex justify-between items-center mt-1"><span className="text-[10px] uppercase text-slate-500">RAP</span><span className="text-sm font-bold text-emerald-400">{it.rap != null ? Number(it.rap).toLocaleString() : '—'}</span></div>
                              {it.serialNumber && <p className="text-[10px] text-violet-300 mt-0.5">#{it.serialNumber}</p>}
                            </div>
                          </Card>
                        ))}
                      </div>}
                </TabsContent>
                <TabsContent value="regular" className="mt-4">
                  {!items ? <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
                    : items.items.length === 0 ? <Empty text="No public regular items (or inventory is private)." />
                    : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                        {items.items.map(it => (
                          <Card key={it.assetId} className="overflow-hidden bg-[#0e0d16] border-white/5">
                            <div className="aspect-square bg-white/[0.03]"><img src={it.imageUrl} className="w-full h-full object-cover" alt="" /></div>
                            <div className="p-2"><p className="text-xs font-semibold truncate">{it.name}</p><p className="text-[10px] text-slate-500">{it.category}</p></div>
                          </Card>
                        ))}
                      </div>}
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="gamepasses" className="mt-5">
              {!gp ? <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
                : (gp.passes || []).length === 0 ? <Empty text="No public game passes found for this account." />
                : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {gp.passes.map(p => (
                      <Card key={p.id} className="p-3 bg-[#0e0d16] border-white/5 flex items-center gap-3">
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
                      <Card className="p-5 bg-[#12101f]/60 border-white/5">
                        <p className="text-[11px] uppercase tracking-widest text-slate-400 font-bold flex items-center gap-1"><Gem className="w-3.5 h-3.5" /> Limiteds</p>
                        <p className="text-3xl font-black text-violet-300 mt-1">{limCount.toLocaleString()}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">collectible items held</p>
                      </Card>
                      <Card className="p-5 bg-[#12101f]/60 border-white/5">
                        <p className="text-[11px] uppercase tracking-widest text-slate-400 font-bold flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> 12-mo Trend</p>
                        <p className={`text-3xl font-black mt-1 ${delta == null ? 'text-slate-400' : delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">total RAP change</p>
                      </Card>
                    </div>

                    {/* RAP history graph */}
                    <Card className="p-5 bg-[#12101f]/60 border-white/5">
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

                    <Card className="p-6 bg-[#12101f]/60 border-white/5 max-w-2xl">
                      {[['User ID', profile.id], ['Username', '@' + profile.name], ['Display Name', profile.displayName], ['Account Created', new Date(profile.created).toLocaleString()], ['Verified Badge', profile.hasVerifiedBadge ? 'Yes' : 'No'], ['Banned', profile.isBanned ? 'Yes' : 'No']].map(([k, v]) => (
                        <div key={k} className="flex justify-between py-2.5 border-b border-white/5 last:border-0"><span className="text-slate-400">{k}</span><span className="font-semibold">{String(v)}</span></div>
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
        <img src={user.avatarUrl} className="w-16 h-16 rounded-2xl bg-white/10" alt="" />
        <div><h1 className="text-2xl font-black">{user.username}</h1><p className="text-sm text-slate-400">Buyer account · pays with crypto</p></div>
        {user.isAdmin && <Button className="ml-auto bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/30" variant="outline" onClick={() => go('admin')}><Shield className="w-4 h-4 mr-1" /> Admin Console</Button>}
      </div>
      <Tabs defaultValue="purchases">
        <TabsList className="bg-[#12101f] border border-white/5"><TabsTrigger value="purchases">Purchases</TabsTrigger><TabsTrigger value="wishlist">Wishlist</TabsTrigger></TabsList>
        <TabsContent value="purchases" className="mt-5">
          {orders.length === 0 ? <Empty text="No purchases yet. Browse the marketplace to buy your first item." /> : (
            <div className="space-y-3">{orders.map(o => (
              <Card key={o.id} className="p-4 bg-[#12101f]/60 border-white/5 flex items-center gap-4 cursor-pointer" onClick={() => go('order', { orderId: o.orderId })}>
                <img src={o.item.imageUrl} className="w-14 h-14 rounded-lg object-cover" alt="" />
                <div className="flex-1"><p className="font-bold">{o.item.name}</p><p className="text-xs text-slate-400">from {o.sellerName} · {new Date(o.createdAt).toLocaleDateString()} · paid in {o.currency}</p></div>
                <Badge className={o.status === 'paid' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : o.status === 'pending_payment' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-red-500/15 text-red-300 border-red-500/30'}>{o.status === 'pending_payment' ? 'pending' : o.status}</Badge>
                <PriceTag price={o.amountUsd} />
              </Card>))}</div>
          )}
        </TabsContent>
        <TabsContent value="wishlist" className="mt-5">
          {wishlist.length === 0 ? <Empty text="Your wishlist is empty. Tap the heart on any item." /> : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">{wishlist.map(it => (
              <Card key={it.id} onClick={() => go('browse', { search: it.name })} className="overflow-hidden bg-[#12101f]/80 border-white/5 cursor-pointer hover:border-violet-500/40"><img src={it.imageUrl} className="w-full aspect-square object-cover" alt="" /><div className="p-2"><p className="text-xs font-semibold truncate">{it.name}</p></div></Card>))}</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ================= Admin =================
function AdminView({ api, user, go, cfg }) {
  const [tab, setTab] = useState('listings')
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

  const load = useCallback(async () => {
    try {
      const [s, i, v, l, o, u, r] = await Promise.all([api('/admin/stats'), api('/admin/items'), api('/admin/vendors'), api('/admin/listings'), api('/admin/orders'), api('/admin/users'), api('/admin/reports')])
      setStats(s); setItems(i.items); setVendors(v.vendors); setListings(l.listings); setOrders(o.orders); setUsers(u.users); setReports(r.reports)
    } catch (e) {}
  }, [api])
  useEffect(() => { if (user?.isAdmin) load() }, [load, user])

  if (!user || !user.isAdmin) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <Shield className="w-12 h-12 mx-auto text-violet-400 mb-4" /><h2 className="text-2xl font-bold mb-2">Admin Access Required</h2>
        <p className="text-slate-400 max-w-md mx-auto">Sign in with the admin account to manage items, listings, users and orders.</p>
        <Button className="mt-4 bg-gradient-to-r from-violet-500 to-fuchsia-600" onClick={() => go('home')}>Go home</Button>
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
        <h1 className="text-3xl font-black flex items-center gap-2"><Shield className="w-7 h-7 text-fuchsia-400" /> Admin Console</h1>
        <div className="flex gap-2">
          <Button variant="outline" className="border-white/10" onClick={() => setVendorOpen(true)}><Store className="w-4 h-4 mr-1" /> New Store</Button>
          <Button className="bg-gradient-to-r from-violet-500 to-fuchsia-600 font-semibold" onClick={() => setImportOpen(true)}><Plus className="w-4 h-4 mr-1" /> Import from Roblox</Button>
        </div>
      </div>
      {!cfg?.cryptoConfigured && <div className="mb-6 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-center gap-2"><Bitcoin className="w-4 h-4" /> Crypto checkout is in DEMO mode. Add your BlockBee API key to <code className="mx-1">BLOCKBEE_API_KEY</code> in the server env to accept real payments.</div>}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-8">
        {stats && [['Users', stats.users], ['Items', stats.items], ['Listings', stats.listings], ['Orders', stats.orders], ['Revenue', usd(stats.revenue)], ['Reports', stats.reports]].map(([k, v]) => (
          <Card key={k} className="p-4 bg-[#12101f]/60 border-white/5"><p className="text-xs uppercase text-slate-400 font-bold">{k}</p><p className="text-2xl font-black text-violet-300">{v}</p></Card>
        ))}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-[#12101f] border border-white/5 flex-wrap h-auto"><TabsTrigger value="listings">Listings</TabsTrigger><TabsTrigger value="items">Items</TabsTrigger><TabsTrigger value="orders">Transactions</TabsTrigger><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="reports">Reports</TabsTrigger><TabsTrigger value="profiles"><User className="w-3.5 h-3.5 mr-1" /> Profiles</TabsTrigger></TabsList>

        <TabsContent value="listings" className="mt-4 space-y-2">
          {listings.length === 0 && <Empty text="No listings yet. Click 'Import from Roblox' to add one." />}
          {listings.map(l => (
            <Card key={l.id} className="p-3 bg-[#12101f]/60 border-white/5 flex items-center gap-3">
              <img src={l.item.imageUrl} className="w-10 h-10 rounded object-cover bg-white/5" alt="" />
              <div className="flex-1"><p className="font-semibold text-sm">{l.item.name}</p><p className="text-xs text-slate-400">{l.sellerName} · {usd(l.price)} · {l.condition} · <span className={l.status === 'sold' ? 'text-red-400' : 'text-emerald-400'}>{l.status}</span>{typeof l.stock === 'number' ? ` · ${l.stock} in stock` : ''}</p></div>
              {l.status !== 'removed' && <Button size="sm" variant="outline" className="border-white/10" onClick={() => setEditL(l)}>Edit stock</Button>}
              {l.status !== 'removed' && <Button size="sm" variant="destructive" onClick={() => removeListing(l.id)}><Trash2 className="w-3.5 h-3.5" /></Button>}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="items" className="mt-4 space-y-2">
          {items.map(it => (
            <Card key={it.id} className="p-3 bg-[#12101f]/60 border-white/5 flex items-center gap-3">
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
              <Card className="p-3 bg-[#12101f]/60 border-white/5 flex items-center gap-3 hover:border-violet-500/40 transition-colors cursor-pointer">
                <img src={o.item.imageUrl} className="w-9 h-9 rounded object-cover" alt="" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm flex items-center gap-2">{o.txNumber ? <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30">#{o.txNumber}</Badge> : null} <span className="truncate">{o.item.name}</span></p>
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
            <Card key={u.id} className="p-3 bg-[#12101f]/60 border-white/5 flex items-center gap-3">
              <img src={u.avatarUrl} className="w-9 h-9 rounded-full bg-white/10" alt="" />
              <div className="flex-1"><div className="font-semibold text-sm flex items-center gap-1">{u.username} {u.isAdmin && <Badge className="bg-fuchsia-500/20 text-fuchsia-300">admin</Badge>}</div><p className="text-xs text-slate-400">{u.email} · joined {new Date(u.createdAt).toLocaleDateString()}</p></div>
              {!u.isAdmin && <Button size="sm" variant="destructive" onClick={() => removeUser(u.id)}><Trash2 className="w-3.5 h-3.5" /></Button>}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="reports" className="mt-4 space-y-2">
          {reports.length === 0 && <Empty text="No reports." />}
          {reports.map(r => (
            <Card key={r.id} className="p-3 bg-[#12101f]/60 border-white/5 flex items-center gap-3">
              <Flag className="w-5 h-5 text-red-400" />
              <div className="flex-1"><p className="font-semibold text-sm">{r.reason}</p><p className="text-xs text-slate-400">by {r.reporterName} · {r.status}</p></div>
              {r.status === 'open' && <Button size="sm" onClick={() => resolveReport(r.id)}>Resolve</Button>}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="profiles" className="mt-6">
          <div className="mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-violet-400" />
            <h2 className="text-xl font-black">Roblox Profile Importer</h2>
          </div>
          <ProfilesView api={api} embedded />
        </TabsContent>
      </Tabs>

      <CreateVendorDialog open={vendorOpen} setOpen={setVendorOpen} api={api} onCreated={() => { load(); toast.success('Store created') }} />
      <ImportListingDialog open={importOpen} setOpen={setImportOpen} api={api} vendors={vendors} onCreated={() => { load(); toast.success('Item listed on the marketplace') }} />
      <EditStockDialog listing={editL} setListing={setEditL} api={api} onSaved={() => { load(); toast.success('Listing updated') }} />
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
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Gem className="w-5 h-5 text-fuchsia-400" /> Import Roblox Item</DialogTitle><DialogDescription className="text-slate-400">Paste a Roblox link to auto-fill the name, description & image. Edit anything, then set your own price.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-slate-300">Roblox item link</Label>
            <div className="flex gap-2 mt-1">
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.roblox.com/catalog/1028606/..." className="bg-black/30 border-white/10" onKeyDown={e => e.key === 'Enter' && doFetch()} />
              <Button onClick={doFetch} disabled={fetching} className="bg-violet-500 shrink-0">{fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Detect'}</Button>
            </div>
            {!showForm && <button onClick={() => setShowForm(true)} className="text-xs text-slate-400 hover:text-violet-300 mt-2">or enter details manually</button>}
          </div>

          {showForm && (
            <div className="space-y-4 pt-1 border-t border-white/5">
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
              <div><Label className="text-slate-300">Store (optional)</Label><Select value={form.vendorId} onValueChange={v => set('vendorId', v)}><SelectTrigger className={inp}><SelectValue placeholder="Robloot Market (default)" /></SelectTrigger><SelectContent className="bg-[#12101f] border-white/10 text-slate-100">{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
          )}
        </div>
        <DialogFooter><Button disabled={loading || !showForm} onClick={publish} className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-600 font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'List on Marketplace'}</Button></DialogFooter>
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
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Package className="w-5 h-5 text-violet-400" /> Edit Listing</DialogTitle><DialogDescription className="text-slate-400">{listing?.item?.name}. Set stock to 0 to mark sold out, or add stock to relist.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-slate-300">Stock (qty)</Label><Input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} className="bg-black/30 border-white/10 mt-1" /></div>
          <div><Label className="text-slate-300">Price (USD)</Label><Input type="number" value={price} onChange={e => setPrice(e.target.value)} className="bg-black/30 border-white/10 mt-1" /></div>
        </div>
        <DialogFooter><Button disabled={loading} onClick={save} className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-600 font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}</Button></DialogFooter>
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
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Store className="w-5 h-5 text-violet-400" /> New Store / Vendor</DialogTitle><DialogDescription className="text-slate-400">Stores are the sellers shown on listings.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-slate-300">Store name</Label><Input className="bg-black/30 border-white/10 mt-1" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="PixelKing" /></div>
          <div><Label className="text-slate-300">Reputation (1-5)</Label><Input type="number" step="0.1" min="1" max="5" className="bg-black/30 border-white/10 mt-1" value={form.reputation} onChange={e => setForm({ ...form, reputation: e.target.value })} /></div>
        </div>
        <DialogFooter><Button disabled={loading} onClick={submit} className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-600 font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Store'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

