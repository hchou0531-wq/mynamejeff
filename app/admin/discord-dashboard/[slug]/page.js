'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, ShieldCheck, Lock, Bot, MessageSquare, Package, DollarSign, Clock, CheckCircle2, AlertTriangle } from 'lucide-react'

const api = async (path, opts = {}) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('rbx_token') : null
  const res = await fetch(`/api${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export default function DiscordDashboardPage() {
  const params = useParams()
  const slug = params?.slug
  const [step, setStep] = useState('checking') // checking | denied | code | ready
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [err, setErr] = useState('')
  const [overview, setOverview] = useState(null)
  const [botCfg, setBotCfg] = useState(null)
  const [form, setForm] = useState({ discordBotToken: '', discordClientId: '', discordGuildId: '', discordChannelId: '', robloxEnabled: false })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const me = await api('/me')
        if (!me?.user?.isAdmin) { setStep('denied'); return }
        setStep('code')
      } catch { setStep('denied') }
    })()
  }, [])

  const loadDashboard = useCallback(async () => {
    try {
      const [ov, bc] = await Promise.all([api('/admin/dashboard/overview'), api('/admin/dashboard/bot-config')])
      setOverview(ov); setBotCfg(bc.config)
      setForm(f => ({ ...f, discordClientId: bc.config.discordClientId || '', discordGuildId: bc.config.discordGuildId || '', discordChannelId: bc.config.discordChannelId || '', robloxEnabled: !!bc.config.robloxEnabled }))
    } catch (e) { setErr(e.message) }
  }, [])

  const verify = async () => {
    setVerifying(true); setErr('')
    try {
      await api('/admin/dashboard/verify', { method: 'POST', body: JSON.stringify({ slug, code: code.trim() }) })
      await loadDashboard()
      setStep('ready')
    } catch (e) { setErr(e.message) } finally { setVerifying(false) }
  }

  const saveBot = async () => {
    setSaving(true)
    try {
      const body = { discordClientId: form.discordClientId, discordGuildId: form.discordGuildId, discordChannelId: form.discordChannelId, robloxEnabled: form.robloxEnabled }
      if (form.discordBotToken.trim()) body.discordBotToken = form.discordBotToken.trim()
      await api('/admin/dashboard/bot-config', { method: 'POST', body: JSON.stringify(body) })
      setForm(f => ({ ...f, discordBotToken: '' }))
      await loadDashboard()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  // ---------- gate screens ----------
  if (step === 'checking') return <Center><Loader2 className="w-8 h-8 animate-spin text-violet-400" /></Center>
  if (step === 'denied') return (
    <Center>
      <div className="text-center">
        <Lock className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <h1 className="text-2xl font-black text-slate-200">404 — Not found</h1>
        <p className="text-slate-500 mt-2 text-sm">This page is not available.</p>
      </div>
    </Center>
  )
  if (step === 'code') return (
    <Center>
      <div className="w-full max-w-sm bg-[#12101f] border border-white/10 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-1"><ShieldCheck className="w-5 h-5 text-emerald-400" /><h1 className="text-lg font-black text-slate-100">Two-factor verification</h1></div>
        <p className="text-xs text-slate-400 mb-4">Enter the one-time code shown in your Admin Console. It expires shortly and works only once.</p>
        <input value={code} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} onKeyDown={e => { if (e.key === 'Enter') verify() }} placeholder="6-digit code" className="w-full text-center tracking-[0.5em] text-xl font-bold bg-black/40 border border-white/10 rounded-lg py-3 text-slate-100 outline-none focus:border-violet-500" />
        {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
        <button onClick={verify} disabled={verifying || code.length < 6} className="w-full mt-4 py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-600 font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">{verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unlock dashboard'}</button>
      </div>
    </Center>
  )

  // ---------- dashboard ----------
  const s = overview?.stats || {}
  return (
    <div className="min-h-screen bg-[#0a0912] text-slate-100">
      <header className="border-b border-white/5 bg-[#0a0912]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center"><MessageSquare className="w-5 h-5 text-white" /></div>
          <div><h1 className="font-black leading-tight">Discord Dashboard</h1><p className="text-[11px] text-slate-500">Robloot fulfillment control</p></div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${overview?.botConfigured ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}><Bot className="w-3.5 h-3.5" /> Bot {overview?.botConfigured ? 'online' : 'not configured'}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {err && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{err}</div>}

        {/* stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat icon={Package} label="Total orders" value={s.total ?? 0} color="violet" />
          <Stat icon={CheckCircle2} label="Paid" value={s.paid ?? 0} color="emerald" />
          <Stat icon={Clock} label="Pending" value={s.pending ?? 0} color="amber" />
          <Stat icon={DollarSign} label="Revenue" value={`$${Number(s.revenue || 0).toFixed(2)}`} color="sky" />
        </div>

        {/* bot config */}
        <section className="bg-[#12101f]/60 border border-white/5 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1"><Bot className="w-5 h-5 text-indigo-400" /><h2 className="font-black">Bot configuration</h2></div>
          <p className="text-xs text-slate-400 mb-4">Enter your Discord bot keys here. The Roblox bot uses the account <span className="text-slate-200 font-semibold">voIIium</span> (cookie already configured). Turn on the Roblox bot when ready.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={`Discord Bot Token ${botCfg?.discordBotTokenSet ? `(saved: ${botCfg.discordBotTokenMasked})` : ''}`}>
              <input value={form.discordBotToken} onChange={e => setForm({ ...form, discordBotToken: e.target.value })} placeholder={botCfg?.discordBotTokenSet ? 'Enter to replace' : 'Paste bot token'} className="inp" />
            </Field>
            <Field label="Discord Client ID"><input value={form.discordClientId} onChange={e => setForm({ ...form, discordClientId: e.target.value })} placeholder="application id" className="inp" /></Field>
            <Field label="Guild (Server) ID"><input value={form.discordGuildId} onChange={e => setForm({ ...form, discordGuildId: e.target.value })} placeholder="server id" className="inp" /></Field>
            <Field label="Orders Channel ID"><input value={form.discordChannelId} onChange={e => setForm({ ...form, discordChannelId: e.target.value })} placeholder="channel id" className="inp" /></Field>
          </div>
          <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={form.robloxEnabled} onChange={e => setForm({ ...form, robloxEnabled: e.target.checked })} className="w-4 h-4 accent-violet-500" />
            Enable Roblox trade bot (voIIium)
          </label>
          <div className="flex justify-end mt-4"><button onClick={saveBot} disabled={saving} className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-600 font-bold text-white disabled:opacity-50 flex items-center gap-2">{saving && <Loader2 className="w-4 h-4 animate-spin" />} Save configuration</button></div>
          {!overview?.botConfigured && <p className="text-xs text-amber-300 mt-3 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Bot actions are inactive until a Discord token is saved and the Roblox bot is enabled.</p>}
        </section>

        {/* orders */}
        <section className="bg-[#12101f]/60 border border-white/5 rounded-2xl p-5">
          <h2 className="font-black mb-4 flex items-center gap-2"><Package className="w-5 h-5 text-violet-400" /> Orders &amp; fulfillment</h2>
          <div className="space-y-2">
            {(overview?.orders || []).length === 0 && <p className="text-sm text-slate-500 py-6 text-center">No orders yet.</p>}
            {(overview?.orders || []).map(o => (
              <div key={o.orderId} className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-black/30 border border-white/5">
                {o.item?.imageUrl && <img src={o.item.imageUrl} className="w-10 h-10 rounded-md object-cover bg-black/40" alt="" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{o.item?.name || 'Item'} <span className="text-slate-500 font-normal">· #{o.txNumber ?? '—'}</span></p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {o.buyerInfo?.discordName ? `Discord: ${o.buyerInfo.discordName}${o.buyerInfo.discordTag ? '#' + o.buyerInfo.discordTag : ''} · ` : ''}
                    {o.buyerInfo?.robloxUsername ? `Roblox: ${o.buyerInfo.robloxUsername}` : ''}
                    {o.buyerInfo?.robloxUserId ? ` (${o.buyerInfo.robloxUserId})` : ''}
                  </p>
                  {Array.isArray(o.buyerInfo?.giveItems) && o.buyerInfo.giveItems.length > 0 && (
                    <p className="text-[11px] text-slate-500 truncate">Gives: {o.buyerInfo.giveItems.map(g => `${g.name} (RAP ${g.rap ?? '—'})`).join(', ')}</p>
                  )}
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${o.status === 'paid' ? 'bg-emerald-500/15 text-emerald-300' : o.status === 'pending_payment' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-500/15 text-slate-300'}`}>{o.status}</span>
                <span className="text-sm font-bold">${Number(o.amountUsd || 0).toFixed(2)}</span>
                <button onClick={async () => { try { await api('/admin/dashboard/fulfill', { method: 'POST', body: JSON.stringify({ orderId: o.orderId }) }) } catch (e) { setErr(e.message) } }} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10">Send trade</button>
              </div>
            ))}
          </div>
        </section>
      </main>
      <style jsx global>{`.inp{width:100%;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:0.5rem;padding:0.5rem 0.75rem;color:#e2e8f0;font-size:0.875rem;outline:none}.inp:focus{border-color:#8b5cf6}`}</style>
    </div>
  )
}

function Center({ children }) { return <div className="min-h-screen bg-[#0a0912] flex items-center justify-center p-4">{children}</div> }
function Stat({ icon: Icon, label, value, color }) {
  const c = { violet: 'text-violet-300', emerald: 'text-emerald-300', amber: 'text-amber-300', sky: 'text-sky-300' }[color] || 'text-slate-300'
  return (
    <div className="bg-[#12101f]/60 border border-white/5 rounded-2xl p-4">
      <div className="flex items-center gap-2 text-slate-500 text-[11px] uppercase tracking-wider"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <p className={`text-2xl font-black mt-1 ${c}`}>{value}</p>
    </div>
  )
}
function Field({ label, children }) { return <div><label className="text-[11px] text-slate-500 block mb-1">{label}</label>{children}</div> }
