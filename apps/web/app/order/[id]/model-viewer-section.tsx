'use client'
import { ModelViewer } from '@/components/ModelViewer'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface ModelViewerSectionProps {
  glbUrl: string
  orderId: string
}

export function ModelViewerSection({ glbUrl, orderId }: ModelViewerSectionProps) {
  const router = useRouter()

  // Auto-refresh while in transient states
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(interval)
  }, [router])

  return <ModelViewer glbUrl={glbUrl} alt="3D relief preview" className="w-full" />
}
