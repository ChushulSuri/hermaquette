'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * After the customer pays, paying the vendor is automatic — no human approval
 * step in the UI. This fires the (idempotent) governed vendor-checkout once on
 * mount, then polls (router.refresh) until the order advances to
 * checkout_approved — at which point canvas-pane stops rendering this component
 * (so the interval clears) and shows the "Order Confirmed" card. Governance
 * (fail-closed spend cap) still runs server-side.
 */
export function AutoCheckout({ orderId }: { orderId: string }) {
  const router = useRouter()
  const fired = useRef(false)
  const ticks = useRef(0)

  useEffect(() => {
    if (!fired.current) {
      fired.current = true
      fetch(`/api/orders/${orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_vendor_checkout' }),
      }).catch(() => { /* idempotent; polling reconciles */ })
    }
    // Poll until the order leaves the checkout-in-progress states (then this
    // component unmounts and the interval is cleared). Safety cap ~75s.
    const iv = setInterval(() => {
      ticks.current += 1
      router.refresh()
      if (ticks.current > 25) clearInterval(iv)
    }, 3000)
    return () => clearInterval(iv)
  }, [orderId, router])

  return (
    <div className="mb-6 p-6 rounded-xl bg-indigo-900/20 border border-indigo-800 text-center">
      <div className="animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full mx-auto mb-3" />
      <p className="text-sm text-indigo-300">Hermes is completing your order…</p>
    </div>
  )
}
