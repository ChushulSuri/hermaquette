'use client'
import { useEffect, useRef } from 'react'

interface ModelViewerProps {
  glbUrl: string
  alt?: string
  className?: string
}

// Declare the model-viewer custom element type
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          alt?: string
          'camera-controls'?: boolean | string
          'auto-rotate'?: boolean | string
          'shadow-intensity'?: string
          exposure?: string
          style?: React.CSSProperties
        },
        HTMLElement
      >
    }
  }
}

export function ModelViewer({ glbUrl, alt = '3D model preview', className = '' }: ModelViewerProps) {
  const scriptLoaded = useRef(false)

  useEffect(() => {
    if (scriptLoaded.current) return
    scriptLoaded.current = true

    const script = document.createElement('script')
    script.type = 'module'
    // Prefer the local copy baked into public/ by the Dockerfile; fall back to CDN.
    script.src = '/model-viewer.min.js'
    script.onerror = () => {
      const fallback = document.createElement('script')
      fallback.type = 'module'
      fallback.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js'
      document.head.appendChild(fallback)
    }
    document.head.appendChild(script)
  }, [])

  return (
    <div className={`relative ${className}`}>
      <model-viewer
        src={glbUrl}
        alt={alt}
        camera-controls="true"
        auto-rotate="true"
        shadow-intensity="1"
        exposure="1"
        style={{
          width: '100%',
          height: '400px',
          background: 'linear-gradient(135deg, #0f0020 0%, #1a0040 100%)',
          borderRadius: '12px',
        }}
      />
      <div className="absolute bottom-3 right-3 text-xs text-gray-400 bg-black/50 px-2 py-1 rounded">
        Drag to rotate · Scroll to zoom
      </div>
    </div>
  )
}
