'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Event {
  id: number
  stage: string
  event: string
  message: string
  data: string
  created_at: number
}

interface ChatPaneProps {
  orderId: string
  initialEvents: Event[]
  orderState: string
}

interface Bubble {
  id: string
  role: 'agent' | 'user' | 'system'
  message: string
  stage: string
  event: string
  timestamp: number
  icon?: string
}

function eventToBubble(evt: Event): Bubble | null {
  const data = (() => { try { return JSON.parse(evt.data) } catch { return {} } })()

  // Map event types to chat bubbles
  if (evt.event === 'started' && evt.stage === 'orchestrator') {
    return {
      id: `evt-${evt.id}`,
      role: 'agent',
      message: evt.message || 'Hermaquette is analyzing your request...',
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: '▶',
    }
  }

  if (evt.event === 'images_ready') {
    return {
      id: `evt-${evt.id}`,
      role: 'agent',
      message: 'Concept images generated — pick a direction to continue.',
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: '★',
    }
  }

  if (evt.event === 'delegate_task') {
    const agent = data.agent || data.child_role || 'sub-agent'
    return {
      id: `evt-${evt.id}`,
      role: 'agent',
      message: `Hermaquette delegated to ${agent}`,
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: '→',
    }
  }

  if (evt.event === 'progress') {
    return {
      id: `evt-${evt.id}`,
      role: 'agent',
      message: evt.message || 'Working...',
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: '◎',
    }
  }

  if (evt.event === 'dfm_pass' || evt.event === 'dfm_pass_after_fix') {
    return {
      id: `evt-${evt.id}`,
      role: 'agent',
      message: evt.message || 'DFM check passed',
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: '✓',
    }
  }

  if (evt.event === 'dfm_fail' || evt.event === 'fix_applied') {
    return {
      id: `evt-${evt.id}`,
      role: 'agent',
      message: evt.message || 'DFM issue detected — auto-repairing...',
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: '⚙',
    }
  }

  if (evt.event === 'explanation' || evt.event === 'nemotron_explanation') {
    return {
      id: `evt-${evt.id}`,
      role: 'agent',
      message: evt.message || 'Nemotron analysis',
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: '»',
    }
  }

  if (evt.event === 'confirmed' && evt.stage === 'payment') {
    return {
      id: `evt-${evt.id}`,
      role: 'system',
      message: 'Payment confirmed (TEST MODE)',
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: '✓',
    }
  }

  if (evt.event === 'checkout_approved') {
    return {
      id: `evt-${evt.id}`,
      role: 'system',
      message: 'Governed checkout approved',
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: '✓',
    }
  }

  if (evt.event === 'checkout_blocked') {
    return {
      id: `evt-${evt.id}`,
      role: 'system',
      message: evt.message || 'Checkout gate blocked',
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: '✗',
    }
  }

  if (evt.event === 'error') {
    return {
      id: `evt-${evt.id}`,
      role: 'system',
      message: evt.message || 'Pipeline error',
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: '✗',
    }
  }

  // Skip low-signal events (stream.complete, stream.error)
  if (evt.event === 'stream.complete' || evt.event === 'stream.error') {
    return null
  }

  // message.delta is handled by coalescing in the component — never render individually
  if (evt.event === 'message.delta') {
    return null
  }

  // Tool events — show a human-readable label
  if (evt.event === 'tool.started' || evt.event === 'tool.completed') {
    const toolName = data.tool || data.name || evt.stage || 'a step'
    const label = evt.event === 'tool.started'
      ? `Working on ${toolName}...`
      : `${toolName} completed`
    return {
      id: `evt-${evt.id}`,
      role: 'agent',
      message: label,
      stage: evt.stage,
      event: evt.event,
      timestamp: evt.created_at,
      icon: evt.event === 'tool.started' ? '⚙' : '✓',
    }
  }

  // Generic fallback
  const fallbackMessage = (() => {
    const raw = evt.message || `${evt.stage}: ${evt.event}`
    // Strip any leading "undefined:" prefix
    return raw.replace(/^undefined\s*:\s*/, '').trim() || 'Processing...'
  })()

  return {
    id: `evt-${evt.id}`,
    role: 'agent',
    message: fallbackMessage,
    stage: evt.stage,
    event: evt.event,
    timestamp: evt.created_at,
    icon: '·',
  }
}

export function ChatPane({ orderId, initialEvents, orderState }: ChatPaneProps) {
  const router = useRouter()
  const [bubbles, setBubbles] = useState<Bubble[]>(() =>
    initialEvents
      .slice()
      .reverse() // chronological order (oldest first)
      .map(eventToBubble)
      .filter((b): b is Bubble => b !== null)
  )
  const seenIds = useRef(new Set(bubbles.map(b => b.id)))
  const scrollRef = useRef<HTMLDivElement>(null)
  const [connected, setConnected] = useState(false)

  // message.delta coalescing
  const deltaBuffer = useRef('')
  const deltaTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deltaBubbleId = useRef(`delta-${Date.now()}`)
  // Tracks which state-change events already triggered a canvas refresh, so we
  // don't re-mount the 3D <model-viewer> (and restart its GLB load) repeatedly.
  const refreshedStates = useRef<Set<string>>(new Set())

  const appendBubble = useCallback((bubble: Bubble) => {
    if (seenIds.current.has(bubble.id)) return
    seenIds.current.add(bubble.id)
    setBubbles(prev => [...prev, bubble])
  }, [])

  const flushDelta = useCallback(() => {
    if (!deltaBuffer.current) return
    const text = deltaBuffer.current
    deltaBuffer.current = ''
    const id = deltaBubbleId.current
    if (seenIds.current.has(id)) {
      // Update existing delta bubble
      setBubbles(prev => prev.map(b => b.id === id ? { ...b, message: text } : b))
    } else {
      appendBubble({
        id,
        role: 'agent',
        message: text,
        stage: 'message',
        event: 'message.delta',
        timestamp: Date.now(),
        icon: '✦',
      })
    }
    deltaBubbleId.current = `delta-${Date.now()}`
  }, [appendBubble])

  const scheduleFlush = useCallback(() => {
    if (deltaTimer.current) clearTimeout(deltaTimer.current)
    deltaTimer.current = setTimeout(() => {
      flushDelta()
      deltaTimer.current = null
    }, 300)
  }, [flushDelta])

  // SSE subscription with reconnect + backoff
  useEffect(() => {
    let evtSource: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectDelay = 1000

    function connect() {
      evtSource = new EventSource(`/api/orders/${orderId}/events`)
      evtSource.onmessage = (msg) => {
        reconnectDelay = 1000
        try {
          const evt = JSON.parse(msg.data) as Event
          if (evt.event === 'stream.complete') {
            flushDelta()
            setConnected(false)
            evtSource?.close()
            // Only refresh on stream end if a state-change refresh hasn't already
            // covered it — avoids re-mounting the 3D <model-viewer> needlessly.
            if (!refreshedStates.current.has('__stream_done__')) {
              refreshedStates.current.add('__stream_done__')
              router.refresh()
            }
            return
          }
          if (evt.event === 'stream.error') {
            return
          }
          if (evt.event === 'message.delta') {
            const data = (() => { try { return JSON.parse(evt.data) } catch { return {} } })()
            deltaBuffer.current += data.text || data.delta || data.content || ''
            deltaBubbleId.current = deltaBubbleId.current || `delta-${Date.now()}`
            scheduleFlush()
            return
          }
          // Flush any pending delta before rendering a discrete event
          if (deltaBuffer.current) flushDelta()
          // Refresh the canvas ONCE per distinct state-change event. Refreshing on
          // every duplicate event re-mounts <model-viewer> and restarts its GLB
          // load, so the 3D figure never finishes rendering.
          if (['images_ready', 'concept_approved', 'preview', 'manufacturable', 'quote', 'paid', 'checkout_approved'].includes(evt.event)
              && !refreshedStates.current.has(evt.event)) {
            refreshedStates.current.add(evt.event)
            refreshedStates.current.delete('__stream_done__')
            router.refresh()
          }
          const bubble = eventToBubble(evt)
          if (bubble) appendBubble(bubble)
        } catch { /* malformed */ }
      }
      evtSource.onopen = () => {
        setConnected(true)
        reconnectDelay = 1000
      }
      evtSource.onerror = () => {
        setConnected(false)
        evtSource?.close()
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000)
          connect()
        }, reconnectDelay)
      }
    }

    connect()

    return () => {
      if (deltaTimer.current) clearTimeout(deltaTimer.current)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      evtSource?.close()
    }
  }, [orderId, appendBubble, flushDelta, scheduleFlush, router])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [bubbles])

  const isTerminal = ['error', 'checkout_approved', 'checkout_blocked', 'delivered'].includes(orderState)

  const [revisionText, setRevisionText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [revisionError, setRevisionError] = useState('')

  async function handleRevise() {
    if (!revisionText.trim() || submitting) return
    setSubmitting(true)
    setRevisionError('')
    try {
      const res = await fetch(`/api/orders/${orderId}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: revisionText.trim() }),
      })
      if (res.ok) {
        setRevisionText('')
      } else {
        const data = await res.json().catch(() => ({}))
        setRevisionError(data.error || 'Revision failed')
      }
    } catch {
      setRevisionError('Network error')
    }
    setSubmitting(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="px-4 py-3 border-b flex items-center gap-2"
        style={{ borderColor: '#1e1e2e' }}>
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-gray-600'}`} />
        <span className="text-xs font-medium" style={{ color: '#9090a8' }}>
          {isTerminal ? 'Pipeline complete' : connected ? 'Live' : 'Connecting...'}
        </span>
      </div>

      {/* Bubbles */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {bubbles.length === 0 && (
          <div className="text-sm animate-pulse" style={{ color: '#5a5a72' }}>
            Hermaquette is starting the pipeline...
          </div>
        )}

        {bubbles.map((bubble) => (
          <div key={bubble.id} className={`flex ${bubble.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                bubble.role === 'user'
                  ? 'rounded-br-md'
                  : 'rounded-bl-md'
              }`}
              style={{
                background: bubble.role === 'user'
                  ? 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)'
                  : bubble.role === 'system'
                    ? 'rgba(16,185,129,0.1)'
                    : '#16161f',
                border: bubble.role === 'system'
                  ? '1px solid rgba(16,185,129,0.3)'
                  : '1px solid #1e1e2e',
                color: bubble.role === 'user' ? '#fff' : '#d1d5db',
              }}
            >
              {bubble.icon && (
                <span className="mr-1.5 opacity-60">{bubble.icon}</span>
              )}
              {bubble.message}
            </div>
          </div>
        ))}
      </div>

      {/* Revision input — only in concept state */}
      {orderState === 'concept' && (
        <div className="px-4 py-3 border-t" style={{ borderColor: '#1e1e2e' }}>
          <div className="flex gap-2">
            <input
              type="text"
              value={revisionText}
              onChange={e => setRevisionText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRevise()}
              placeholder="Request a revision (e.g., make it taller, rounder...)"
              className="flex-1 bg-[#16161f] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
              disabled={submitting}
            />
            <button
              onClick={handleRevise}
              disabled={!revisionText.trim() || submitting}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              {submitting ? '...' : 'Revise'}
            </button>
          </div>
          {revisionError && <p className="text-xs text-red-400 mt-1">{revisionError}</p>}
        </div>
      )}
    </div>
  )
}
