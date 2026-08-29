'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, ShieldCheck, Lock, Bot, MessageSquare, Package, DollarSign, Clock, CheckCircle2, AlertTriangle, LayoutDashboard, Users, Ticket, Settings, Trash2, Plus, Power, Copy, KeyRound } from 'lucide-react'

const api = async (path, opts = {}) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('rbx_token') : null
  const res = await fetch(`/api${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}
const copy = (t) => { try { navigator.clipboard?.writeText(t) } catch {} }

export default function DiscordDashboardPage() {
  const params = useParams()
  const slug = params?.slug
  const [step, setStep] = useState('checking') // checking | denied | code | ready
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [err, setErr] = useState('')
  const [section, setSection] = useState('overview')

  const [overview, setOverview] = useState(null)
  const [botCfg, setBotCfg] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [toycodes, setToycodes] = useState([])
  const [form, setForm] = useState({ discordBotToken: '', discordClientId: '', discordGuildId: '', discordChannelId: '' })
  const [saving, setSaving] = useState(false)
  const [newAcc, setNewAcc] = useState({ title: '', price: '', imageUrl: '', username: '', password: '', email: '', notes: '' })
  const [newTc, setNewTc] = useState({ title: '', price: '', imageUrl: '', code: '' })

  useEffect(() => {
    (async () => {
      try { const me = await api('/me'); if (!me?.user?.isAdmin) { setStep('denied'); return } setStep('code') }
      catch { setStep('denied') }
    })()
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const [ov, bc, ac, tc] = await Promise.all([api('/admin/dashboard/overview'), api('/admin/dashboard/bot-config'), api('/admin/dashboard/accounts'), api('/admin/dashboard/toycodes')])
      setOverview(ov); setBotCfg(bc.config); setAccounts(ac.accounts || []); setToycodes(tc.toycodes || [])
      setForm(f => ({ ...f, discordClientId: bc.config.discordClientId || '', discordGuildId: bc.config.discordGuildId || '', discordChannelId: bc.config.discordChannelId || '' }))
    } catch (e) { setErr(e.message) }
  }, [])

  const verify = async () => {
    setVerifying(true); setErr('')
    try { await api('/admin/dashboard/verify', { method: 'POST', body: JSON.stringify({ slug, code: code.trim() }) }); await loadAll(); setStep('ready') }
    catch (e) { setErr(e.message) } finally { setVerifying(false) }
  }
  const setBot = async (patch) => { try { await api('/admin/dashboard/bot-config', { method: 'POST', body: JSON.stringify(patch) }); await loadAll() } catch (e) { setErr(e.message) } }
  const saveBot = async () => {
    setSaving(true)
    try {
      const body = { discordClientId: form.discordClientId, discordGuildId: form.discordGuildId, discordChannelId: form.discordChannelId }
      if (form.discordBotToken.trim()) body.discordBotToken = form.discordBotToken.trim()
      await api('/admin/dashboard/bot-config', { method: 'POST', body: JSON.stringify(body) })
      setForm(f => ({ ...f, discordBotToken: '' })); await loadAll()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  const addAccount = async () => { try { await api('/admin/dashboard/accounts', { method: 'POST', body: JSON.stringify({ ...newAcc, price: Number(newAcc.price) || 0 }) }); setNewAcc({ title: '', price: '', imageUrl: '', username: '', password: '', email: '', notes: '' }); await loadAll() } catch (e) { setErr(e.message) } }
  const addToycode = async () => { try { await api('/admin/dashboard/toycodes', { method: 'POST', body: JSON.stringify({ ...newTc, price: Number(newTc.price) || 0 }) }); setNewTc({ title: '', price: '', imageUrl: '', code: '' }); await loadAll() } catch (e) { setErr(e.message) } }
  const del = async (type, id) => { try { await api(`/admin/dashboard/${type}/${id}`, { method: 'DELETE' }); await loadAll() } catch (e) { setErr(e.message) } }
  const assign = async (type, id, orderNumber) => { if (!orderNumber) { setErr('Enter an order number to assign'); return } try { await api('/admin/dashboard/assign', { method: 'POST', body: JSON.stringify({ type, id, orderNumber }) }); await loadAll() } catch (e) { setErr(e.message) } }

  if (step === 'checking') return <Center><Loader2 className="w-8 h-8 animate-spin text-violet-400" /></Center>
  if (step === 'denied') return <Center><div className="text-center"><Lock className="w-10 h-10 text-slate-600 mx-auto mb-3" /><h1 className="text-2xl font-black text-slate-200">404 — Not found</h1><p className="text-slate-500 mt-2 text-sm">This page is not available.</p></div></Center>
  if (step === 'code') return (
    <Center>
      <div className="w-full max-w-sm bg-[#12101f] border border-white/10 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-1"><ShieldCheck className="w-5 h-5 text-emerald-400" /><h1 className="text-lg font-black text-slate-100">Two-factor verification</h1></div>
        <p className="text-xs text-slate-400 mb-4">Enter the one-time code from your Admin Console. It expires shortly and works only once.</p>
        <input value={code} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} onKeyDown={e => { if (e.key === 'Enter') verify() }} placeholder="6-digit code" className="w-full text-center tracking-[0.5em] text-xl font-bold bg-black/40 border border-white/10 rounded-lg py-3 text-slate-100 outline-none focus:border-violet-500" />
        {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
        <button onClick={verify} disabled={verifying || code.length < 6} className="w-full mt-4 py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-600 font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">{verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unlock dashboard'}</button>
      </div>
    </Center>
  )

  const s = overview?.stats || {}
  const online = overview?.botOnline
  const NAV = [['overview', 'Overview', LayoutDashboard], ['orders', 'Orders', Package], ['profiles', 'Profiles', Users], ['toycodes', 'Toy Codes', Ticket], ['general', 'General', Settings]]
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="min-h-screen bg-[#0a0912] text-slate-100 flex">
      <aside className="w-56 shrink-0 border-r border-white/5 bg-[#0c0a16] hidden md:flex flex-col">
        <div className="h-16 flex items-center gap-2 px-4 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center"><MessageSquare className="w-4 h-4 text-white" /></div>
          <div><p className="font-black text-sm leading-tight">Discord</p><p className="text-[10px] text-slate-500">Dashboard</p></div>
        </div>
        <nav className="p-2 flex-1">
          {NAV.map(([key, label, Icon]) => (
            <button key={key} onClick={() => setSection(key)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${section === key ? 'bg-violet-500/15 text-violet-200' : 'text-slate-400 hover:bg-white/5'}`}><Icon className="w-4 h-4" /> {label}</button>
          ))}
        </nav>
        <div className="p-3 border-t border-white/5">
          <div className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg ${online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-400'}`}><Bot className="w-3.5 h-3.5" /> Bot {online ? 'online' : 'offline'}</div>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="h-16 border-b border-white/5 flex items-center px-4 gap-3 sticky top-0 bg-[#0a0912]/80 backdrop-blur z-10">
          <h1 className="font-black capitalize">{NAV.find(n => n[0] === section)?.[1]}</h1>
          <div className="ml-auto flex items-center gap-2">
            <select value={section} onChange={e => setSection(e.target.value)} className="md:hidden bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-sm">{NAV.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${overview?.botConfigured ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}><Bot className="w-3.5 h-3.5" /> {overview?.botConfigured ? 'configured' : 'no token'}</span>
          </div>
        </header>

        <main className="p-4 md:p-6 space-y-5 max-w-5xl">
          {err && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center justify-between"><span>{err}</span><button onClick={() => setErr('')} className="text-red-400">×</button></div>}

          {section === 'overview' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat icon={Package} label="Total orders" value={s.total ?? 0} color="violet" />
                <Stat icon={CheckCircle2} label="Paid" value={s.paid ?? 0} color="emerald" />
                <Stat icon={Clock} label="Pending" value={s.pending ?? 0} color="amber" />
                <Stat icon={DollarSign} label="Revenue" value={`$${Number(s.revenue || 0).toFixed(2)}`} color="sky" />
                <Stat icon={Users} label="Profiles" value={s.accounts ?? 0} color="violet" />
                <Stat icon={Ticket} label="Toy codes" value={s.toycodes ?? 0} color="fuchsia" />
              </div>
              <Panel title="Recent orders" icon={Package}><OrderList orders={overview?.orders} /></Panel>
            </>
          )}

          {section === 'orders' && <Panel title="All orders & fulfillment" icon={Package}><OrderList orders={overview?.orders} full /></Panel>}

          {section === 'profiles' && (
            <>
              <Panel title="Add account for sale" icon={Plus}>
                <div className="grid sm:grid-cols-2 gap-2">
                  <Inp v={newAcc.title} set={x => setNewAcc({ ...newAcc, title: x })} ph="Title (e.g. OG 2015 Account)" />
                  <Inp v={newAcc.price} set={x => setNewAcc({ ...newAcc, price: x })} ph="Price (USD)" type="number" />
                  <Inp v={newAcc.username} set={x => setNewAcc({ ...newAcc, username: x })} ph="Roblox username" />
                  <Inp v={newAcc.password} set={x => setNewAcc({ ...newAcc, password: x })} ph="Password" />
                  <Inp v={newAcc.email} set={x => setNewAcc({ ...newAcc, email: x })} ph="Email (optional)" />
                  <Inp v={newAcc.imageUrl} set={x => setNewAcc({ ...newAcc, imageUrl: x })} ph="Image URL (optional)" />
                  <textarea value={newAcc.notes} onChange={e => setNewAcc({ ...newAcc, notes: e.target.value })} placeholder="Notes / extra login info (optional)" className="inp sm:col-span-2" />
                </div>
                <div className="flex justify-end mt-3"><Btn onClick={addAccount}>Add account</Btn></div>
              </Panel>
              <Panel title={`Accounts (${accounts.length})`} icon={Users}><InventoryList items={accounts} type="account" onDelete={del} onAssign={assign} /></Panel>
            </>
          )}

          {section === 'toycodes' && (
            <>
              <Panel title="Add toy code" icon={Plus}>
                <div className="grid sm:grid-cols-2 gap-2">
                  <Inp v={newTc.title} set={x => setNewTc({ ...newTc, title: x })} ph="Title (e.g. Roblox Toy - Ninja)" />
                  <Inp v={newTc.price} set={x => setNewTc({ ...newTc, price: x })} ph="Price (USD)" type="number" />
                  <Inp v={newTc.code} set={x => setNewTc({ ...newTc, code: x })} ph="Toy code (e.g. ABC-123-XYZ)" />
                  <Inp v={newTc.imageUrl} set={x => setNewTc({ ...newTc, imageUrl: x })} ph="Image URL (optional)" />
                </div>
                <div className="flex justify-end mt-3"><Btn onClick={addToycode}>Add toy code</Btn></div>
              </Panel>
              <Panel title={`Toy codes (${toycodes.length})`} icon={Ticket}><InventoryList items={toycodes} type="toycode" onDelete={del} onAssign={assign} /></Panel>
            </>
          )}

          {section === 'general' && (
            <>
              <Panel title="Bot power" icon={Power}>
                <div className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold">Roblox trade bot — <span className="text-slate-300">voIIium</span></p><p className="text-xs text-slate-500">Turn the fulfillment bot online or offline.</p></div>
                  <button onClick={() => setBot({ botOnline: !online })} className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 ${online ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-500/20 text-slate-300 border border-white/10'}`}><Power className="w-4 h-4" /> {online ? 'Online' : 'Offline'}</button>
                </div>
                <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={!!botCfg?.robloxEnabled} onChange={e => setBot({ robloxEnabled: e.target.checked })} className="w-4 h-4 accent-violet-500" /> Enable Roblox trade automation
                </label>
              </Panel>

              <Panel title="Secrets & keys" icon={KeyRound}>
                <p className="text-xs text-slate-400 mb-3">Enter your Discord bot keys. The Roblox bot cookie is already configured server-side.</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label={`Discord Bot Token ${botCfg?.discordBotTokenSet ? `(saved: ${botCfg.discordBotTokenMasked})` : ''}`}><Inp v={form.discordBotToken} set={x => setForm({ ...form, discordBotToken: x })} ph={botCfg?.discordBotTokenSet ? 'Enter to replace' : 'Paste bot token'} /></Field>
                  <Field label="Discord Client (Application) ID"><Inp v={form.discordClientId} set={x => setForm({ ...form, discordClientId: x })} ph="application id" /></Field>
                  <Field label="Guild (Server) ID"><Inp v={form.discordGuildId} set={x => setForm({ ...form, discordGuildId: x })} ph="server id" /></Field>
                  <Field label="Orders Channel ID"><Inp v={form.discordChannelId} set={x => setForm({ ...form, discordChannelId: x })} ph="channel id" /></Field>
                </div>
                <div className="flex justify-end mt-3"><Btn onClick={saveBot} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin mr-1 inline" />}Save keys</Btn></div>

                <div className="mt-5 grid gap-2">
                  <SecretRow label="Discord Public Key (env DISCORD_PUBLIC_KEY)" ok={botCfg?.discordPublicKeySet} note="Needed to verify /claim slash-command requests." />
                  <SecretRow label="Bot shared secret (env BOT_SHARED_SECRET)" ok={botCfg?.botSharedSecretSet} note="Bot uses this to call the claim API." />
                  <SecretRow label="Dashboard secret link (env ADMIN_DASHBOARD_SECRET)" ok={botCfg?.dashboardSecretSet} />
                </div>
                <div className="mt-4 p-3 rounded-lg bg-black/30 border border-white/5">
                  <p className="text-[11px] text-slate-400 mb-1">Discord Interactions Endpoint URL (paste into the Discord Developer Portal):</p>
                  <div className="flex items-center gap-2"><code className="text-xs text-slate-200 break-all flex-1">{origin}/api/discord/interactions</code><button onClick={() => copy(`${origin}/api/discord/interactions`)} className="text-slate-400 hover:text-white"><Copy className="w-4 h-4" /></button></div>
                </div>
                <p className="text-[11px] text-amber-300 mt-3 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Buyers claim by typing <code className="mx-1">/claim &lt;order number&gt;</code> in the orders channel. Assign a Profile/Toy Code to their order number first (in those tabs).</p>
              </Panel>
            </>
          )}
        </main>
      </div>
      <style jsx global>{`.inp{width:100%;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:0.5rem;padding:0.5rem 0.75rem;color:#e2e8f0;font-size:0.875rem;outline:none}.inp:focus{border-color:#8b5cf6}`}</style>
    </div>
  )
}

function Center({ children }) { return <div className="min-h-screen bg-[#0a0912] flex items-center justify-center p-4">{children}</div> }
function Stat({ icon: Icon, label, value, color }) {
  const c = { violet: 'text-violet-300', emerald: 'text-emerald-300', amber: 'text-amber-300', sky: 'text-sky-300', fuchsia: 'text-fuchsia-300' }[color] || 'text-slate-300'
  return <div className="bg-[#12101f]/60 border border-white/5 rounded-2xl p-4"><div className="flex items-center gap-2 text-slate-500 text-[11px] uppercase tracking-wider"><Icon className="w-3.5 h-3.5" /> {label}</div><p className={`text-2xl font-black mt-1 ${c}`}>{value}</p></div>
}
function Panel({ title, icon: Icon, children }) { return <section className="bg-[#12101f]/60 border border-white/5 rounded-2xl p-5"><h2 className="font-black mb-4 flex items-center gap-2">{Icon && <Icon className="w-5 h-5 text-violet-400" />} {title}</h2>{children}</section> }
function Field({ label, children }) { return <div><label className="text-[11px] text-slate-500 block mb-1">{label}</label>{children}</div> }
function Inp({ v, set, ph, type = 'text' }) { return <input type={type} value={v} onChange={e => set(e.target.value)} placeholder={ph} className="inp" /> }
function Btn({ children, onClick, disabled }) { return <button onClick={onClick} disabled={disabled} className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-600 font-bold text-white text-sm disabled:opacity-50">{children}</button> }
function SecretRow({ label, ok, note }) { return <div className="flex items-center gap-2 text-sm"><span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-slate-600'}`} /><span className="text-slate-300">{label}</span><span className={`text-xs ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>{ok ? 'set' : 'not set'}</span>{note && <span className="text-[11px] text-slate-500 ml-auto hidden sm:block">{note}</span>}</div> }
function StatusPill({ status }) {
  const m = { available: 'bg-sky-500/15 text-sky-300', sold: 'bg-amber-500/15 text-amber-300', claimed: 'bg-emerald-500/15 text-emerald-300' }
  return <span className={`text-[11px] px-2 py-0.5 rounded-full ${m[status] || 'bg-slate-500/15 text-slate-300'}`}>{status}</span>
}
function InventoryList({ items, type, onDelete, onAssign }) {
  const [orderNums, setOrderNums] = useState({})
  if (!items || items.length === 0) return <p className="text-sm text-slate-500 py-4 text-center">Nothing here yet.</p>
  return (
    <div className="space-y-2">
      {items.map(it => (
        <div key={it.id} className="p-3 rounded-xl bg-black/30 border border-white/5">
          <div className="flex items-center gap-3">
            {it.imageUrl && <img src={it.imageUrl} className="w-10 h-10 rounded-md object-cover bg-black/40" alt="" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{it.title} <span className="text-slate-500 font-normal">· ${Number(it.price || 0).toFixed(2)}</span></p>
              <p className="text-[11px] text-slate-500 truncate">{type === 'toycode' ? `Code: ${it.code}` : `${it.credentials?.username} / ${it.credentials?.password}${it.credentials?.email ? ' · ' + it.credentials.email : ''}`}{it.claimOrderNumber ? ` · order #${it.claimOrderNumber}` : ''}</p>
            </div>
            <StatusPill status={it.status} />
            <button onClick={() => onDelete(type === 'toycode' ? 'toycodes' : 'accounts', it.id)} className="text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
          </div>
          {it.status !== 'claimed' && (
            <div className="flex items-center gap-2 mt-2">
              <input value={orderNums[it.id] || ''} onChange={e => setOrderNums({ ...orderNums, [it.id]: e.target.value })} placeholder="Order # to assign" className="inp max-w-[180px] py-1 text-xs" />
              <button onClick={() => onAssign(type, it.id, orderNums[it.id])} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10">Assign to order</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
function OrderList({ orders, full }) {
  if (!orders || orders.length === 0) return <p className="text-sm text-slate-500 py-4 text-center">No orders yet.</p>
  const list = full ? orders : orders.slice(0, 10)
  return (
    <div className="space-y-2">
      {list.map(o => (
        <div key={o.orderId} className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-black/30 border border-white/5">
          {o.item?.imageUrl && <img src={o.item.imageUrl} className="w-10 h-10 rounded-md object-cover bg-black/40" alt="" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{o.item?.name || 'Item'} <span className="text-slate-500 font-normal">· #{o.txNumber ?? '—'}</span></p>
            <p className="text-[11px] text-slate-400 truncate">{o.buyerInfo?.discordName ? `Discord: ${o.buyerInfo.discordName}${o.buyerInfo.discordTag ? '#' + o.buyerInfo.discordTag : ''} · ` : ''}{o.buyerInfo?.robloxUsername ? `Roblox: ${o.buyerInfo.robloxUsername}` : ''}{o.buyerInfo?.robloxUserId ? ` (${o.buyerInfo.robloxUserId})` : ''}</p>
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-full ${o.status === 'paid' ? 'bg-emerald-500/15 text-emerald-300' : o.status === 'pending_payment' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-500/15 text-slate-300'}`}>{o.status}</span>
          <span className="text-sm font-bold">${Number(o.amountUsd || 0).toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}
