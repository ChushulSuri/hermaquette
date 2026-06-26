'use client'
import { useState } from 'react'

interface PayButtonProps {
  orderId: string
  revenueCents: number
  currency?: string
}

export function PayButton({ orderId, revenueCents, currency }: PayButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const symbol = (currency || 'usd').toLowerCase() === 'eur' ? '€' : '$'

  async function handlePay() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-demo-token': process.env.NEXT_PUBLIC_DEMO_TOKEN || '',
        },
        body: JSON.stringify({ order_id: orderId }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setError(data.error || 'Failed to create checkout session')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={handlePay}
        disabled={loading}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-4 px-8 rounded-xl text-lg transition-colors shadow-lg shadow-emerald-900/50"
      >
        {loading ? 'Opening Stripe...' : `Pay ${symbol}${(revenueCents / 100).toFixed(2)} (TEST MODE)`}
      </button>
      {error && <p className="text-red-400 text-sm mt-2 text-center">{error}</p>}
      <p className="text-xs text-gray-500 text-center mt-2">
        Use test card: 4242 4242 4242 4242 · Any future date · Any CVC
      </p>
      <p className="text-xs text-gray-600 text-center">
        No real charge · Stripe TEST MODE · Keep this tab open until redirected back
      </p>
    </div>
  )
}
