'use client'
import { ModelViewer } from '@/components/ModelViewer'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const HDRI_URL = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3/examples/assets/neutral.hdr'

interface ModelViewerSectionProps {
  glbUrl?: string | null
  orderId: string
  orderState?: string
}

function getStateBadge(state?: string): { label: string; className: string } | null {
  if (!state) return null
  if (state === 'concept' || state === 'geometry') {
    return { label: 'Concept Preview', className: 'bg-blue-900 border border-blue-600 text-blue-200' }
  }
  if (state === 'dfm' || state === 'repairing') {
    return { label: 'DFM Repair in progress', className: 'bg-yellow-900 border border-yellow-600 text-yellow-200' }
  }
  if (state === 'manufacturable') {
    return { label: 'Manufacturable', className: 'bg-green-900 border border-green-600 text-green-200' }
  }
  if (state === 'quote' || state.startsWith('checkout_')) {
    return { label: 'Ready to Order', className: 'bg-green-900 border border-green-600 text-green-200' }
  }
  return null
}

const PRINT_DISCLOSURE_STATES = new Set(['manufacturable', 'quote', 'paid', 'checkout_pending_approval', 'checkout_approved'])

export function ModelViewerSection({ glbUrl, orderId, orderState }: ModelViewerSectionProps) {
  const router = useRouter()

  // Auto-refresh while in transient states
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(interval)
  }, [router])

  const badge = getStateBadge(orderState)
  const showDisclosure = !!glbUrl && !!orderState && PRINT_DISCLOSURE_STATES.has(orderState)

  return (
    <div data-agent="model-viewer-section">
      {badge && (
        <div className="flex items-center mb-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${badge.className}`}>
            {badge.label}
          </span>
        </div>
      )}

      {glbUrl ? (
        <ModelViewer
          glbUrl={glbUrl}
          alt="3D figure preview"
          className="w-full"
          environmentImage={HDRI_URL}
        />
      ) : (
        <div className="bg-gray-900 border border-gray-700 rounded-xl h-40 flex items-center justify-center text-gray-500 text-sm">
          3D model generating...
        </div>
      )}

      {showDisclosure && (
        <p className="text-xs text-gray-500 mt-2">
          Interactive viewer shows full-color design. Printed artifact uses single material color (PA12 SLS).
        </p>
      )}
    </div>
  )
}
