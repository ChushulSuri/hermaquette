'use client'

import { useEffect, useRef } from 'react'

/**
 * After the customer pays, paying the vendor is automatic — no human approval
 * step in the UI. This fires the (idempotent) governed vendor-checkout once on
 * mount and shows a loader until the run completes and the page advances to
 * checkout_approved. Governance (fail-closed spend cap) still runs server-side.
 */
export function AutoCheckout({ orderId }: { orderId: string }) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    fetch(`/api/orders/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve_vendor_checkout' }),
    }).catch(() => { /* idempotent; SSE/refresh will reconcile */ })
  }, [orderId])

  return (
    <div className="mb-6 p-6 rounded-xl bg-indigo-900/20 border border-indigo-800 text-center">
      <div className="animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full mx-auto mb-3" />
      <p className="text-sm text-indigo-300">Hermes is completing your order…</p>
    </div>
  )
}
