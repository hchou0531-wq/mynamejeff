'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

export default function TransactionPage() {
  const params = useParams()
  const num = params?.num
  const [state, setState] = useState('loading') // loading | denied | notfound | ok
  const [tx, setTx] = useState(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('rbx_token') : null
      if (!token) { if (!cancelled) setState('denied'); return }
      try {
        const res = await fetch(`/api/transaction/${num}`, { headers: { Authorization: `Bearer ${token}` } })
        if (res.status === 403 || res.status === 401) { if (!cancelled) setState('denied'); return }
        if (res.status === 404) { if (!cancelled) setState('notfound'); return }
        const d = await res.json()
        if (!res.ok) { if (!cancelled) setState('denied'); return }
        if (!cancelled) { setTx(d.transaction); setState('ok') }
      } catch (e) {
        if (!cancelled) setState('denied')
      }
    }
    run()
    return () => { cancelled = true }
  }, [num])

  if (state === 'loading') {
    return (
      <main className="min-h-screen bg-[#0a0912] text-slate-100 flex items-center justify-center">
        <p className="text-slate-400">Loading…</p>
      </main>
    )
  }

  // Only admins can see this page. Everyone else just sees "page 505".
  if (state === 'denied' || state === 'notfound') {
    return (
      <main className="min-h-screen bg-[#0a0912] text-slate-100 flex items-center justify-center">
        <h1 className="text-4xl font-black tracking-tight">page 505</h1>
      </main>
    )
  }

  const bi = tx?.buyerInfo || {}
  const paid = tx?.status === 'paid'
  const Row = ({ label, value, mono }) => (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-white/5">
      <span className="text-xs uppercase tracking-widest text-slate-500">{label}</span>
      <span className={`text-sm text-right ${mono ? 'font-mono break-all' : ''}`}>{value ?? '—'}</span>
    </div>
  )

  return (
    <main className="min-h-screen bg-[#0a0912] text-slate-100 py-16 px-4">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-black">Transaction #{tx?.txNumber}</h1>
          <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${paid ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>
            {tx?.status === 'pending_payment' ? 'pending' : tx?.status}
          </span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#12101f]/60 p-6">
          {tx?.item && (
            <div className="flex items-center gap-4 mb-4">
              <img src={tx.item.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover bg-white/5" />
              <div>
                <p className="font-bold text-lg">{tx.item.name}</p>
                <p className="text-xs text-slate-400">{tx.item.category}</p>
              </div>
            </div>
          )}

          <Row label="Amount (USD)" value={`$${Number(tx?.amountUsd || 0).toFixed(2)}`} />
          <Row label="Currency" value={tx?.currency} />
          <Row label="Provider" value={tx?.provider} />
          <Row label="Discord" value={bi.discordName ? `${bi.discordName}${bi.discordTag ? '#' + bi.discordTag : ''}` : '—'} />
          <Row label="Roblox username" value={bi.robloxUsername} />
          <Row label="Buyer account" value={tx?.buyerName} />
          <Row label="Order ID" value={tx?.orderId} mono />
          {tx?.blockbeePaymentId && <Row label="BlockBee payment ID" value={tx.blockbeePaymentId} mono />}
          <Row label="Created" value={tx?.createdAt ? new Date(tx.createdAt).toLocaleString() : '—'} />
          <Row label="Paid at" value={tx?.paidAt ? new Date(tx.paidAt).toLocaleString() : '—'} />

          {tx?.checkoutUrl && (
            <a href={tx.checkoutUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-block w-full text-center bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold py-3 rounded-xl">
              Open crypto checkout
            </a>
          )}
        </div>
      </div>
    </main>
  )
}
