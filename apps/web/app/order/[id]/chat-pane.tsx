'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

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

  // Generic fallback
  return {
    id: `evt-${evt.id}`,
    role: 'agent',
    message: evt.message || `${evt.stage}: ${evt.event}`,
    stage: evt.stage,
    event: evt.event,
    timestamp: evt.created_at,
    icon: '·',
  }
}

export function ChatPane({ orderId, initialEvents, orderState }: ChatPaneProps) {
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

  const appendBubble = useCallback((bubble: Bubble) => {
    if (seenIds.current.has(bubble.id)) return
    seenIds.current.add(bubble.id)
    setBubbles(prev => [...prev, bubble])
  }, [])

  // SSE subscription
  useEffect(() => {
    const evtSource = new EventSource(`/api/orders/${orderId}/events`)
    evtSource.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as Event
        if (evt.event === 'stream.complete') {
          setConnected(false)
          evtSource.close()
          return
        }
        if (evt.event === 'stream.error') {
          return
        }
        const bubble = eventToBubble(evt)
        if (bubble) appendBubble(bubble)
      } catch { /* malformed */ }
    }
    evtSource.onopen = () => setConnected(true)
    evtSource.onerror = () => setConnected(false)

    return () => evtSource.close()
  }, [orderId, appendBubble])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [bubbles])

  const isTerminal = ['error', 'checkout_approved', 'checkout_blocked', 'delivered'].includes(orderState)

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
    </div>
  )
}
