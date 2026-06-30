'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Shown while a concept revision regenerates. The live SSE stream closes after
 * the first run, and nothing else polls during the concept state, so this
 * component polls (router.refresh) until the new images_ready lands — at which
 * point revisionInProgress flips false, this unmounts, and the interval clears.
 */
export function RevisingLoader() {
  const router = useRouter()
  const ticks = useRef(0)

  useEffect(() => {
    const iv = setInterval(() => {
      ticks.current += 1
      router.refresh()
      if (ticks.current > 90) clearInterval(iv) // ~6 min safety cap
    }, 4000)
    return () => clearInterval(iv)
  }, [router])

  return (
    <div className="mb-4 p-4 rounded-xl bg-indigo-900/20 border border-indigo-800 flex items-center gap-3">
      <div className="animate-spin w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full" />
      <p className="text-sm text-indigo-300">Revising your concepts — generating a new set…</p>
    </div>
  )
}
