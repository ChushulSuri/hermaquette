'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AgentBadge } from '@/components/AgentBadge'

interface Event {
  id: number
  stage: string
  event: string
  message: string
  data: string
  created_at: number
}

interface EventTimelineProps {
  events: Event[]
  orderId: string
}

function eventIcon(event: string): string {
  const icons: Record<string, string> = {
    started: '▶',
    completed: '✓',
    error: '✗',
    progress: '◎',
    images_ready: '★',
    explanation: '»',
    fix_applied: '⚙',
    awaiting_approval: '⏳',
    confirmed: '✓',
    blocked: '✗',
  }
  return icons[event] || '·'
}

export function EventTimeline({ events, orderId }: EventTimelineProps) {
  const router = useRouter()

  // Auto-refresh every 3s while in active states
  useEffect(() => {
    const lastEvent = events[0]
    const isTerminal = lastEvent && (
      (lastEvent.event === 'completed' && ['checkout_gate', 'payment'].includes(lastEvent.stage)) ||
      lastEvent.event === 'blocked' ||
      lastEvent.event === 'error'
    )
    if (isTerminal) return
    const interval = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(interval)
  }, [events, router])

  if (events.length === 0) {
    return (
      <div className="text-sm text-gray-600 animate-pulse">
        Hermes is starting the pipeline...
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {events.map((evt) => (
        <div key={evt.id} className="flex gap-3 text-sm">
          <span className="text-gray-600 font-mono text-xs mt-0.5 shrink-0 w-16">
            {new Date(evt.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <span className={`shrink-0 w-4 ${evt.event === 'error' ? 'text-red-400' : evt.event === 'completed' ? 'text-green-400' : 'text-purple-400'}`}>
            {eventIcon(evt.event)}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-gray-300">{evt.message}</span>
            <span className="text-gray-600 text-xs ml-2">[{evt.stage}:{evt.event}]</span>
            <AgentBadge agent={(() => { try { return JSON.parse(evt.data)?.agent } catch { return undefined } })()} />
          </div>
        </div>
      ))}
    </div>
  )
}
