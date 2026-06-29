'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface VendorApprovalPanelProps {
  orderId: string
  currency?: string
  vendorCostCents?: number
  spendCapCents?: number
}

export function VendorApprovalPanel({ orderId, currency, vendorCostCents, spendCapCents = 5000 }: VendorApprovalPanelProps) {
  const [approving, setApproving] = useState(false)
  const router = useRouter()
  const ISSUING_ENABLED = process.env.NEXT_PUBLIC_STRIPE_ISSUING_ENABLED === 'true'
  const symbol = (currency || 'usd').toLowerCase() === 'eur' ? '€' : '$'

  async function handleApprove() {
    setApproving(true)
    const res = await fetch(`/api/orders/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve_vendor_checkout' }),
    })
    if (res.ok) router.refresh()
    setApproving(false)
  }

  return (
    <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-6">
      <h3 className="text-yellow-300 font-semibold mb-2">Hermes awaits human approval</h3>
      <p className="text-gray-300 text-sm mb-4">
        Payment confirmed. Hermes now requests approval to pay the vendor (Slant3D) to manufacture — governed by a spend cap.
      </p>

      <div className="bg-gray-900/50 rounded-lg p-4 mb-4 space-y-2 text-sm">
        <div className="flex justify-between text-gray-300">
          <span>Vendor cost</span>
          <span className="font-mono">{symbol}{((vendorCostCents || 0) / 100).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-gray-300">
          <span>Spend cap</span>
          <span className="font-mono">{symbol}{((spendCapCents) / 100).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>Governance method</span>
          <span>{ISSUING_ENABLED ? 'Stripe Issuing virtual card' : 'SQLite approval record'}</span>
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>Execution</span>
          <span className="text-amber-400">GATED — awaiting approval</span>
        </div>
      </div>

      <button
        onClick={handleApprove}
        disabled={approving}
        className="w-full bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
      >
        {approving ? 'Approving...' : `Approve vendor checkout (${ISSUING_ENABLED ? 'issue virtual card' : 'approve record'})`}
      </button>
      <p className="text-xs text-gray-500 mt-2 text-center">
        No real vendor payment executed · Demo only · Governed by spend cap + human approval
      </p>
    </div>
  )
}
