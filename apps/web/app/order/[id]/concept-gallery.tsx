'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface ConceptGalleryProps {
  orderId: string
  images: Array<{ id: string; url: string; source?: string }>
}

export function ConceptGallery({ orderId, images }: ConceptGalleryProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const router = useRouter()

  async function handleApprove() {
    if (!selected) return
    setApproving(true)
    const res = await fetch(`/api/orders/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve_concept', image_id: selected }),
    })
    if (res.ok) {
      router.refresh()
    }
    setApproving(false)
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {images.map((img) => (
          <button
            key={img.id}
            onClick={() => setSelected(img.id)}
            className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
              selected === img.id
                ? 'border-purple-400 ring-2 ring-purple-400/50'
                : 'border-gray-700 hover:border-gray-500'
            }`}
          >
            <img
              src={img.url}
              alt={`Concept option ${img.id}`}
              className="w-full h-full object-cover"
            />
            {selected === img.id && (
              <div className="absolute inset-0 bg-purple-500/20 flex items-center justify-center">
                <span className="text-white text-2xl">✓</span>
              </div>
            )}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleApprove}
          disabled={!selected || approving}
          className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors"
        >
          {approving ? 'Approving...' : 'Approve this direction →'}
        </button>
        {selected && (
          <p className="text-xs text-gray-400">
            Hermes will build the 3D relief from this concept image
          </p>
        )}
      </div>
      <p className="text-xs text-gray-600 mt-2">Indicative price range: $25–$60 depending on complexity and material</p>
    </div>
  )
}
