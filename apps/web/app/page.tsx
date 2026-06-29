import { getAccessCode } from '@/lib/auth'
import { cookies } from 'next/headers'
import { OrderForm } from './components/order-form'
import { AccessGate } from './components/access-gate'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function HomePage() {
  const accessCode = getAccessCode()
  const cookieStore = await cookies()
  const hasCookie = accessCode
    ? cookieStore.get('hm_access_code')?.value === require('crypto').createHash('sha256').update(accessCode).digest('hex')
    : true

  if (!accessCode || hasCookie) {
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

        <OrderForm />

        {/* Footer */}
        <footer className="mt-16 text-center text-xs" style={{ color: '#3a3a52' }}>
          <p>Hermaquette is a hackathon demo.</p>
          <p className="mt-1">No physical item will be shipped during judging unless explicitly arranged.</p>
        </footer>
      </main>
    )
  }

  return (
    <main className="min-h-screen">
      <AccessGate />
    </main>
  )
}
