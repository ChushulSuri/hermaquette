'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function AccessGate() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid access code')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-6"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a855f7' }}>
            ACCESS REQUIRED
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2"
            style={{ color: '#f0f0f8', letterSpacing: '-0.02em' }}>
            Hermaquette
          </h1>
          <p className="text-sm" style={{ color: '#5a5a72' }}>
            Enter the access code to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              id="access-code"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Access code"
              autoFocus
              className="w-full rounded-xl px-4 py-3 text-sm transition-colors text-center tracking-widest"
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
          </div>

          {error && (
            <div className="rounded-lg px-4 py-3 text-sm"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="w-full py-3 px-6 rounded-xl font-semibold text-sm transition-all"
            style={{
              background: loading || !code.trim()
                ? '#1e1e2e'
                : 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
              color: loading || !code.trim() ? '#5a5a72' : '#fff',
              cursor: loading || !code.trim() ? 'not-allowed' : 'pointer',
              border: 'none',
            }}
          >
            {loading ? 'Verifying...' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  )
}
