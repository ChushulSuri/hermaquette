import { redirect } from 'next/navigation'

interface PageProps {
  params: { id: string }
  searchParams: { session_id?: string }
}

export const dynamic = 'force-dynamic'

export default async function SuccessPage({ params, searchParams }: PageProps) {
  const { session_id } = searchParams
  if (!session_id) redirect(`/order/${params.id}`)

  // Server-side confirm the payment
  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/session?session_id=${session_id}&order_id=${params.id}`, {
    cache: 'no-store',
  })
  const data = await res.json()

  if (data.paid) {
    redirect(`/order/${params.id}`)
  }

  // Payment not confirmed
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-red-400 mb-4">Payment not confirmed</h1>
        <p className="text-gray-400 mb-6">
          The session is not yet paid. This can happen if you closed the tab before the redirect completed.
        </p>
        <a href={`/order/${params.id}`} className="text-purple-400 hover:text-purple-300">
          ← Back to order
        </a>
      </div>
    </main>
  )
}
