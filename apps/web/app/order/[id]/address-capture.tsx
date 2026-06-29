'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface AddressCaptureProps {
  orderId: string
}

export function AddressCapture({ orderId }: AddressCaptureProps) {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', street: '', city: '', state: '', zip: '', country: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const isValid = form.name && form.street && form.city && form.zip && form.country

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/orders/${orderId}/address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        // Re-render the page so the Pay button appears (shipToCaptured=true).
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to save address')
        setSubmitting(false)
      }
    } catch {
      setError('Network error')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h3 className="text-sm font-medium text-gray-300">Shipping address <span className="text-gray-500">— required before payment</span></h3>
      {[
        { key: 'name', label: 'Full name', placeholder: 'Jane Doe' },
        { key: 'street', label: 'Street address', placeholder: '123 Main St' },
        { key: 'city', label: 'City', placeholder: 'San Francisco' },
        { key: 'state', label: 'State / Province', placeholder: 'CA' },
        { key: 'zip', label: 'ZIP / Postal code', placeholder: '94102' },
        { key: 'country', label: 'Country', placeholder: 'US' },
      ].map(({ key, label, placeholder }) => (
        <div key={key}>
          <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
          <input
            type="text"
            value={form[key as keyof typeof form]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            placeholder={placeholder}
            className="w-full bg-[#16161f] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
          />
        </div>
      ))}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={!isValid || submitting}
        className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
      >
        {submitting ? 'Saving...' : 'Confirm address & continue to payment →'}
      </button>
      <p className="text-xs text-gray-600">Where your figure would ship. Demo only — no order placed.</p>
    </form>
  )
}
