'use client'
import { useEffect, useRef } from 'react'

interface ModelViewerProps {
  glbUrl: string
  alt?: string
  className?: string
  environmentImage?: string
}

let scriptInjected = false
function ensureScript() {
  if (scriptInjected || typeof window === 'undefined') return
  scriptInjected = true
  if (customElements.get('model-viewer')) return
  const script = document.createElement('script')
  script.type = 'module'
  script.src = '/model-viewer.min.js'
  script.onerror = () => {
    const fb = document.createElement('script')
    fb.type = 'module'
    fb.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js'
    document.head.appendChild(fb)
  }
  document.head.appendChild(script)
}

/**
 * The <model-viewer> element is created IMPERATIVELY and reused across renders.
 * Rendering it as JSX means router.refresh() (which re-runs the server component
 * and rebuilds this subtree) re-creates the element and restarts the multi-MB GLB
 * load — so the figure never finishes rendering. By owning the element in a ref
 * and only updating its `src` when glbUrl changes, the load completes once and
 * survives every refresh. This mirrors the imperative DOM approach that renders
 * the colored model reliably.
 */
export function ModelViewer({ glbUrl, alt = '3D model preview', className = '', environmentImage = 'neutral' }: ModelViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mvRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    ensureScript()
    const host = hostRef.current
    if (!host) return

    // Create once and keep it; on subsequent renders only update the src.
    if (!mvRef.current) {
      const mv = document.createElement('model-viewer')
      mv.setAttribute('alt', alt)
      mv.setAttribute('camera-controls', '')
      mv.setAttribute('auto-rotate', '')
      mv.setAttribute('shadow-intensity', '1')
      mv.setAttribute('exposure', '1.1')
      mv.setAttribute('environment-image', environmentImage)
      mv.style.cssText = 'width:100%;height:400px;background:linear-gradient(135deg,#0f0020 0%,#1a0040 100%);border-radius:12px;'
      mv.setAttribute('src', glbUrl)
      host.appendChild(mv)
      mvRef.current = mv
    } else if (mvRef.current.getAttribute('src') !== glbUrl) {
      mvRef.current.setAttribute('src', glbUrl)
    }
  }, [glbUrl, alt, environmentImage])

  return (
    <div className={`relative ${className}`}>
      <div ref={hostRef} />
      <div className="absolute bottom-3 right-3 text-xs text-gray-400 bg-black/50 px-2 py-1 rounded">
        Drag to rotate · Scroll to zoom
      </div>
    </div>
  )
}
