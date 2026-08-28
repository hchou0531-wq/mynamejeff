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
  Shield, TrendingUp, Clock, Tag, ChevronLeft, LogOut, User, CheckCircle2, Flag, Loader2, Gem, Package, Zap, Bitcoin, Trash2
} from 'lucide-react'

const ROBUX_RATE = 80
const CATEGORIES = ['All', 'Limiteds', 'Accessories', 'UGC', 'Collectibles', 'Gear', 'Faces', 'Bundles']
const CAT_ICONS = { Limiteds: Gem, Accessories: Sparkles, UGC: Package, Collectibles: Star, Gear: Zap, Faces: User, Bundles: LayoutGrid }
const CONDITIONS = ['All', 'Mint', 'Rare', 'New', 'Used']
const rbx = (u) => Math.round(u * ROBUX_RATE).toLocaleString()
const usd = (n) => `$${Number(n).toFixed(2)}`

function useApi() {
  return useCallback(async (path, opts = {}) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('rbx_token') : null
    const res = await fetch(`/api${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) }
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Request failed')
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
            <Button variant="ghost" className="text-slate-300 hover:text-white" onClick={() => go('sellers')}>Sellers</Button>
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
        {view.name === 'order' && <OrderStatusView api={api} go={go} orderId={view.orderId} refreshNotifs={loadNotifs} />}
        {view.name === 'seller' && <SellerView api={api} go={go} name={view.username} />}
        {view.name === 'sellers' && <SellersView api={api} go={go} />}
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


function ItemView({ api, go, listingId, user, requireAuth, cfg }) {
  const [data, setData] = useState(null)
  const [buying, setBuying] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [related, setRelated] = useState([])
  useEffect(() => {
    api(`/listings/${listingId}`).then(d => { setData(d); api(`/listings?category=${encodeURIComponent(d.listing.item.category)}`).then(r => setRelated((r.listings || []).filter(x => x.id !== listingId).slice(0, 4))) }).catch(e => toast.error(e.message))
  }, [api, listingId])

  const buy = async () => {
    setBuying(true)
    try {
      const d = await api('/orders', { method: 'POST', body: JSON.stringify({ listingId }) })
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
              : <Button onClick={() => requireAuth(() => setConfirmOpen(true))} className="w-full h-12 text-base bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 font-bold"><Bitcoin className="w-5 h-5 mr-2" /> Buy with Crypto</Button>}
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

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-[#12101f] border-white/10 text-slate-100">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Bitcoin className="w-5 h-5 text-amber-400" /> Checkout with Crypto</DialogTitle><DialogDescription className="text-slate-400">You'll be redirected to CoinGate's secure hosted checkout to pay.</DialogDescription></DialogHeader>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-black/30">
            <img src={listing.item.imageUrl} className="w-16 h-16 rounded-lg object-cover" alt="" />
            <div className="flex-1"><p className="font-bold">{listing.item.name}</p><p className="text-xs text-slate-400">from {listing.sellerName}</p></div>
            <PriceTag price={listing.price} />
          </div>
          {!cfg?.cryptoConfigured && <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">Demo mode: live crypto isn't configured yet, so this will simulate a confirmed payment.</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button disabled={buying} onClick={buy} className="bg-gradient-to-r from-amber-500 to-orange-500 font-bold">{buying ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Starting...</> : 'Continue to Payment'}</Button>
          </DialogFooter>
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

function OrderStatusView({ api, go, orderId, refreshNotifs }) {
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
              <Button onClick={load} variant="outline" className="border-white/10">Refresh status</Button>
              <Button onClick={simulate} disabled={simulating} className="bg-gradient-to-r from-amber-500 to-orange-500 font-semibold">{simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simulate confirmed payment (demo)'}</Button>
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
      {!cfg?.cryptoConfigured && <div className="mb-6 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-center gap-2"><Bitcoin className="w-4 h-4" /> Crypto checkout is in DEMO mode. Add your CoinGate API token to <code className="mx-1">COINGATE_API_TOKEN</code> in the server env to accept real payments.</div>}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-8">
        {stats && [['Users', stats.users], ['Items', stats.items], ['Listings', stats.listings], ['Orders', stats.orders], ['Revenue', usd(stats.revenue)], ['Reports', stats.reports]].map(([k, v]) => (
          <Card key={k} className="p-4 bg-[#12101f]/60 border-white/5"><p className="text-xs uppercase text-slate-400 font-bold">{k}</p><p className="text-2xl font-black text-violet-300">{v}</p></Card>
        ))}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-[#12101f] border border-white/5 flex-wrap h-auto"><TabsTrigger value="listings">Listings</TabsTrigger><TabsTrigger value="items">Items</TabsTrigger><TabsTrigger value="orders">Transactions</TabsTrigger><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="reports">Reports</TabsTrigger></TabsList>

        <TabsContent value="listings" className="mt-4 space-y-2">
          {listings.map(l => (
            <Card key={l.id} className="p-3 bg-[#12101f]/60 border-white/5 flex items-center gap-3">
              <img src={l.item.imageUrl} className="w-10 h-10 rounded object-cover" alt="" />
              <div className="flex-1"><p className="font-semibold text-sm">{l.item.name}</p><p className="text-xs text-slate-400">{l.sellerName} · {usd(l.price)} · {l.condition} · {l.status}</p></div>
              {l.status === 'active' && <Button size="sm" variant="destructive" onClick={() => removeListing(l.id)}><Trash2 className="w-3.5 h-3.5" /></Button>}
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
            <Card key={o.id} className="p-3 bg-[#12101f]/60 border-white/5 flex items-center gap-3">
              <img src={o.item.imageUrl} className="w-9 h-9 rounded object-cover" alt="" />
              <div className="flex-1"><p className="font-semibold text-sm">{o.item.name}</p><p className="text-xs text-slate-400">{o.buyerName} · {new Date(o.createdAt).toLocaleString()} · {o.currency}</p></div>
              <Badge className={o.status === 'paid' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}>{o.status === 'pending_payment' ? 'pending' : o.status}</Badge>
              <PriceTag price={o.amountUsd} />
            </Card>
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
      </Tabs>

      <CreateVendorDialog open={vendorOpen} setOpen={setVendorOpen} api={api} onCreated={() => { load(); toast.success('Store created') }} />
      <ImportListingDialog open={importOpen} setOpen={setImportOpen} api={api} vendors={vendors} onCreated={() => { load(); toast.success('Item listed on the marketplace') }} />
    </div>
  )
}

function ImportListingDialog({ open, setOpen, api, vendors, onCreated }) {
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [imported, setImported] = useState(null)
  const [manual, setManual] = useState(false)
  const [m, setM] = useState({ name: '', imageUrl: '', rap: '', robuxPrice: '' })
  const [form, setForm] = useState({ stock: '1', price: '', condition: 'Limited', category: 'Limiteds', vendorId: '', durationDays: '30' })
  const [loading, setLoading] = useState(false)

  const reset = () => { setUrl(''); setImported(null); setManual(false); setM({ name: '', imageUrl: '', rap: '', robuxPrice: '' }); setForm({ stock: '1', price: '', condition: 'Limited', category: 'Limiteds', vendorId: '', durationDays: '30' }) }
  const close = (v) => { setOpen(v); if (!v) reset() }

  const doFetch = async () => {
    if (!url) { toast.error('Paste a Roblox item link'); return }
    setFetching(true); setImported(null)
    try { const d = await api('/admin/roblox-lookup', { method: 'POST', body: JSON.stringify({ url }) }); setImported(d.item); setManual(false); toast.success('Item found on Roblox') }
    catch (e) { toast.error(`${e.message}. You can enter details manually.`); setManual(true) }
    finally { setFetching(false) }
  }

  const publish = async () => {
    const src = imported || { name: m.name, imageUrl: m.imageUrl, rap: m.rap ? Number(m.rap) : null, lowestResalePrice: m.robuxPrice ? Number(m.robuxPrice) : null, assetId: parseInt((url.match(/\/(\d+)/) || [])[1]) || null, collectibleItemId: null, description: '' }
    if (!src.name) { toast.error('Item name is required'); return }
    if (!form.price) { toast.error('Enter a USD price'); return }
    setLoading(true)
    try {
      await api('/admin/listings', { method: 'POST', body: JSON.stringify({
        name: src.name, description: src.description || '', imageUrl: src.imageUrl, category: form.category,
        robloxAssetId: src.assetId, rap: src.rap, robuxPrice: src.lowestResalePrice, collectibleItemId: src.collectibleItemId,
        stock: form.stock, price: form.price, condition: form.condition, vendorId: form.vendorId || undefined, durationDays: form.durationDays
      }) })
      close(false); onCreated()
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }

  const ready = imported || (manual && m.name)
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="bg-[#12101f] border-white/10 text-slate-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Gem className="w-5 h-5 text-fuchsia-400" /> Import Roblox Item</DialogTitle><DialogDescription className="text-slate-400">Paste a Roblox limited/catalog link to auto-detect its RAP & Robux price, then set stock and USD price.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-slate-300">Roblox item link</Label>
            <div className="flex gap-2 mt-1">
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.roblox.com/catalog/1028606/..." className="bg-black/30 border-white/10" onKeyDown={e => e.key === 'Enter' && doFetch()} />
              <Button onClick={doFetch} disabled={fetching} className="bg-violet-500 shrink-0">{fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Detect'}</Button>
            </div>
          </div>

          {imported && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-black/30 border border-emerald-500/20">
              {imported.imageUrl ? <img src={imported.imageUrl} className="w-16 h-16 rounded-lg object-cover bg-white/5" alt="" /> : <div className="w-16 h-16 rounded-lg bg-white/5 flex items-center justify-center"><Package className="w-6 h-6 text-slate-500" /></div>}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">{imported.name}</p>
                <div className="flex gap-3 text-xs mt-1">
                  <span className="text-violet-300">RAP: <b>{imported.rap != null ? imported.rap.toLocaleString() : 'N/A'}</b></span>
                  <span className="text-emerald-300">Lowest: <b>{imported.lowestResalePrice != null ? imported.lowestResalePrice.toLocaleString() : 'N/A'} R$</b></span>
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">Asset #{imported.assetId}</p>
              </div>
            </div>
          )}

          {manual && !imported && (
            <div className="space-y-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <p className="text-xs text-amber-300">Manual entry (auto-detect unavailable)</p>
              <Input value={m.name} onChange={e => setM({ ...m, name: e.target.value })} placeholder="Item name" className="bg-black/30 border-white/10" />
              <Input value={m.imageUrl} onChange={e => setM({ ...m, imageUrl: e.target.value })} placeholder="Image URL (optional)" className="bg-black/30 border-white/10" />
              <div className="grid grid-cols-2 gap-2">
                <Input value={m.rap} onChange={e => setM({ ...m, rap: e.target.value })} placeholder="RAP (Robux)" type="number" className="bg-black/30 border-white/10" />
                <Input value={m.robuxPrice} onChange={e => setM({ ...m, robuxPrice: e.target.value })} placeholder="Robux price" type="number" className="bg-black/30 border-white/10" />
              </div>
            </div>
          )}

          {ready && (
            <div className="space-y-4 pt-2 border-t border-white/5">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-slate-300">Stock (qty)</Label><Input type="number" min="1" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} className="bg-black/30 border-white/10 mt-1" /></div>
                <div><Label className="text-slate-300">Price (USD)</Label><Input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="9.99" className="bg-black/30 border-white/10 mt-1" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-slate-300">Category</Label><Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}><SelectTrigger className="bg-black/30 border-white/10 mt-1"><SelectValue /></SelectTrigger><SelectContent className="bg-[#12101f] border-white/10 text-slate-100">{CATEGORIES.filter(c => c !== 'All').map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
                <div><Label className="text-slate-300">Condition</Label><Select value={form.condition} onValueChange={v => setForm({ ...form, condition: v })}><SelectTrigger className="bg-black/30 border-white/10 mt-1"><SelectValue /></SelectTrigger><SelectContent className="bg-[#12101f] border-white/10 text-slate-100">{['Limited', 'Rare', 'Mint', 'New', 'Clean'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div><Label className="text-slate-300">Store (optional)</Label><Select value={form.vendorId} onValueChange={v => setForm({ ...form, vendorId: v })}><SelectTrigger className="bg-black/30 border-white/10 mt-1"><SelectValue placeholder="Robloot Market (default)" /></SelectTrigger><SelectContent className="bg-[#12101f] border-white/10 text-slate-100">{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></div>
              {form.price && <p className="text-xs text-violet-300">Buyers pay {usd(parseFloat(form.price) || 0)} in crypto</p>}
            </div>
          )}
        </div>
        <DialogFooter><Button disabled={loading || !ready} onClick={publish} className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-600 font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'List on Marketplace'}</Button></DialogFooter>
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

