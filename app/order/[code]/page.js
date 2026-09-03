'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Loader2, CheckCircle2, Bitcoin, Package, Copy, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

const usd = (n) => `$${Number(n || 0).toFixed(2)}`
async function copy(t) {
  try { await navigator.clipboard.writeText(t); toast.success('Copied') }
  catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.focus(); ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      toast[ok ? 'success' : 'error'](ok ? 'Copied' : 'Could not copy — select and copy it manually')
    } catch { toast.error('Could not copy — select and copy it manually') }
  }
}

export default function OrderPage() {
  const params = useParams()
  const code = params?.code
  const [order, setOrder] = useState(null)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/by-code/${code}`)
      if (res.status === 404) { setNotFound(true); return }
      const d = await res.json()
      setOrder(d)
    } catch (e) { /* transient */ }
  }, [code])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!order || order.status === 'paid') return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [order, load])

  return (
    <div className="min-h-screen bg-[#0a0912] text-slate-100">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-violet-600/10 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full bg-fuchsia-600/10 blur-[120px]" />
      </div>
      <div className="relative z-10 container mx-auto px-4 py-16 max-w-lg">
        <p className="text-center text-xs uppercase tracking-widest text-slate-500 mb-1">Order</p>
        <h1 className="text-center text-3xl font-black tracking-wide mb-8 bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">/order/{code}</h1>

        {notFound ? (
          <Card className="p-8 bg-[#12101f]/60 border-white/5 text-center">
            <Package className="w-12 h-12 mx-auto mb-3 text-slate-600" />
            <h2 className="text-xl font-black mb-1">Order not found</h2>
            <p className="text-slate-400 text-sm">Double check the link — order codes are case-sensitive.</p>
          </Card>
        ) : !order ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-violet-400" /></div>
        ) : (
          <Card className="p-8 bg-[#12101f]/60 border-white/5 text-center">
            {order.item?.imageUrl && <img src={order.item.imageUrl} className="w-24 h-24 rounded-xl object-cover mx-auto mb-4" alt="" />}
            {order.status === 'paid' ? (
              <>
                <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-9 h-9 text-emerald-400" /></div>
                <h2 className="text-2xl font-black mb-1">Purchase Succeeded!</h2>
                <p className="text-slate-400 mb-6">You now own <span className="text-white font-semibold">{order.item?.name}</span> · {usd(order.amountUsd)}</p>
                <div className="p-4 rounded-xl bg-black/30 border border-white/5 text-left">
                  <p className="text-xs text-slate-400 mb-2">Run this in our Discord server to receive it:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm font-mono bg-black/40 px-3 py-2 rounded-lg">/claim order:{code}</code>
                    <Button size="icon" variant="outline" className="border-white/10 shrink-0" onClick={() => copy(code)}><Copy className="w-4 h-4" /></Button>
                  </div>
                </div>
              </>
            ) : order.status === 'pending_payment' ? (
              <>
                <Loader2 className="w-12 h-12 animate-spin text-amber-400 mx-auto mb-4" />
                <h2 className="text-2xl font-black mb-1">Awaiting Payment</h2>
                <p className="text-slate-400 mb-6">{order.item?.name} · {usd(order.amountUsd)}</p>
                <div className="flex flex-col gap-2">
                  {order.checkoutUrl && <Button onClick={() => window.location.assign(order.checkoutUrl)} className="bg-gradient-to-r from-amber-500 to-orange-500 font-semibold"><Bitcoin className="w-4 h-4 mr-2" /> Open crypto checkout</Button>}
                  <Button onClick={load} variant="outline" className="border-white/10">Refresh status</Button>
                </div>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4"><Package className="w-8 h-8 text-red-400" /></div>
                <h2 className="text-2xl font-black mb-1">Payment {order.status}</h2>
                <p className="text-slate-400">This order did not complete.</p>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
