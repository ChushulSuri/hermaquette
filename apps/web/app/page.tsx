'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

const MATERIALS = [
  { value: 'pa12', label: 'PA12 Nylon', desc: 'Strong, durable, matte finish. Best for functional parts.' },
  { value: 'resin', label: 'Resin (SLA)', desc: 'High detail, smooth surface. Best for detailed figurines.' },
  { value: 'tpu', label: 'TPU Flex', desc: 'Flexible, rubber-like. Best for grips, gaskets, soft objects.' },
]

export default function HomePage() {
  const router = useRouter()
  const [description, setDescription] = useState('')
  const [material, setMaterial] = useState('pa12')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-demo-token': process.env.NEXT_PUBLIC_DEMO_TOKEN ?? '',
        },
        body: JSON.stringify({ description: description.trim(), material }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const { id } = await res.json()
      router.push(`/order/${id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setLoading(false)
    }
  }

  const charCount = description.length
  const charLimit = 2000
  const nearLimit = charCount > charLimit * 0.85

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      {/* Header */}
      <div className="text-center mb-12 max-w-2xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-6"
          style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a855f7' }}>
          STRIPE TEST MODE &nbsp;·&nbsp; DEMO BUILD
        </div>
        <h1 className="text-5xl font-bold tracking-tight mb-4"
          style={{ color: '#f0f0f8', letterSpacing: '-0.02em' }}>
          Hermaquette
        </h1>
        <p className="text-xl mb-3"
          style={{ color: '#9090a8' }}>
          Other agents move bits.{' '}
          <span style={{ color: '#a855f7', fontWeight: 600 }}>We ship atoms.</span>
        </p>
        <p className="text-sm" style={{ color: '#5a5a72' }}>
          Describe an object &rarr; get a validated 3D-printed part mailed to you.
        </p>
        <p className="text-xs mt-3" style={{ color: '#3a3a52' }}>
          Powered by Hermes &nbsp;·&nbsp; NVIDIA Nemotron &nbsp;·&nbsp; Stripe (TEST MODE)
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-5">
        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-2"
            style={{ color: '#9090a8' }}>
            Describe the object you want printed
          </label>
          <div className="relative">
            <textarea
              ref={textareaRef}
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={charLimit}
              required
              rows={5}
              placeholder="e.g. A small keychain fob shaped like a crescent moon, 50mm wide, with a 4mm hole at the top for a keyring. Smooth surface, no text."
              className="w-full rounded-xl px-4 py-3 text-sm resize-none transition-colors"
              style={{
                background: '#111118',
                border: '1px solid #1e1e2e',
                color: '#f0f0f8',
                outline: 'none',
              }}
              onFocus={e => { e.target.style.borderColor = '#7c3aed' }}
              onBlur={e => { e.target.style.borderColor = '#1e1e2e' }}
              disabled={loading}
            />
            <span className={`absolute bottom-3 right-3 text-xs ${nearLimit ? 'text-amber-400' : ''}`}
              style={!nearLimit ? { color: '#3a3a52' } : {}}>
              {charCount}/{charLimit}
            </span>
          </div>
        </div>

        {/* Material */}
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: '#9090a8' }}>
            Material
          </label>
          <div className="grid grid-cols-3 gap-3">
            {MATERIALS.map(m => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMaterial(m.value)}
                disabled={loading}
                className="rounded-xl px-3 py-3 text-left transition-all"
                style={{
                  background: material === m.value ? 'rgba(124,58,237,0.15)' : '#111118',
                  border: material === m.value ? '1px solid #7c3aed' : '1px solid #1e1e2e',
                  color: material === m.value ? '#f0f0f8' : '#9090a8',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                <div className="text-sm font-medium">{m.label}</div>
                <div className="text-xs mt-1 leading-tight" style={{ color: '#5a5a72' }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="rounded-lg px-4 py-3 text-xs leading-relaxed"
          style={{ background: '#111118', border: '1px solid #1e1e2e', color: '#5a5a72' }}>
          One-off personal gift &nbsp;·&nbsp; Not for resale &nbsp;·&nbsp; No affiliation or endorsement claimed
          &nbsp;·&nbsp; Stripe TEST MODE — no real charges will be made
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg px-4 py-3 text-sm"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !description.trim()}
          className="w-full py-3 px-6 rounded-xl font-semibold text-sm transition-all"
          style={{
            background: loading || !description.trim()
              ? '#1e1e2e'
              : 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
            color: loading || !description.trim() ? '#5a5a72' : '#fff',
            cursor: loading || !description.trim() ? 'not-allowed' : 'pointer',
            border: 'none',
          }}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Creating order...
            </span>
          ) : (
            'Start manufacturing pipeline →'
          )}
        </button>
      </form>

      {/* Footer */}
      <footer className="mt-16 text-center text-xs" style={{ color: '#3a3a52' }}>
        <p>Hermaquette is a hackathon demo.</p>
        <p className="mt-1">No physical item will be shipped during judging unless explicitly arranged.</p>
      </footer>
    </main>
  )
}
