import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'

const HERMES_URL = (process.env.HERMES_GATEWAY_URL || 'http://hermes-agent:8642').replace('/v1', '')
const HERMES_KEY = process.env.HERMES_API_KEY || 'hermaquette-local'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: orderId } = params
  const db = getDb()

  const order = db.prepare('SELECT COALESCE(run2_run_id, run_id) as run_id, state FROM orders WHERE id = ?').get(orderId) as
    { run_id: string | null; state: string } | undefined
  if (!order) {
    return new Response('Order not found', { status: 404 })
  }

  const encoder = new TextEncoder()

  // If no run_id yet or order is in terminal state, stream DB events only
  if (!order.run_id || ['error', 'delivered', 'checkout_approved'].includes(order.state)) {
    const events = db.prepare(
      'SELECT id, stage, event, message, data, created_at FROM events WHERE order_id = ? ORDER BY id ASC'
    ).all(orderId) as Array<Record<string, unknown>>

    const stream = new ReadableStream({
      start(controller) {
        for (const ev of events) {
          const data = `data: ${JSON.stringify(ev)}\n\n`
          controller.enqueue(encoder.encode(data))
        }
        controller.enqueue(encoder.encode('data: {"event":"stream.complete"}\n\n'))
        controller.close()
      }
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    })
  }

  // Proxy live SSE from Hermes + mirror to DB
  const stream = new ReadableStream({
    async start(controller) {
      // First: stream existing DB events for hydration
      const pastEvents = db.prepare(
        'SELECT id, stage, event, message, data, created_at FROM events WHERE order_id = ? ORDER BY id ASC'
      ).all(orderId) as Array<Record<string, unknown>>
      for (const ev of pastEvents) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
      }

      // Then: proxy live Hermes SSE
      try {
        const hermesRes = await fetch(
          `${HERMES_URL}/v1/runs/${order.run_id}/events`,
          {
            headers: { 'Authorization': `Bearer ${HERMES_KEY}` },
            signal: req.signal,
          }
        )

        if (!hermesRes.ok || !hermesRes.body) {
          controller.enqueue(encoder.encode(`data: {"event":"stream.error","message":"Hermes stream unavailable"}\n\n`))
          controller.close()
          return
        }

        const reader = hermesRes.body.getReader()
        const textDecoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += textDecoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (!raw || raw === '[DONE]') continue

            try {
              const evt = JSON.parse(raw) as Record<string, unknown>

              // Mirror to events table
              const stage = String(evt.event || 'agent').split('.')[0]
              const message = typeof evt.output === 'string' ? evt.output.slice(0, 500) : ''
              try {
                db.prepare(
                  'INSERT INTO events (order_id, stage, event, message, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
                ).run(orderId, stage, String(evt.event || 'agent_event'), message, JSON.stringify(evt), Date.now())
              } catch { /* duplicate protection */ }

              // Forward to browser
              controller.enqueue(encoder.encode(`data: ${raw}\n\n`))
            } catch { /* malformed line */ }
          }
        }
      } catch (err) {
        if (!req.signal.aborted) {
          const msg = err instanceof Error ? err.message : String(err)
          controller.enqueue(encoder.encode(`data: {"event":"stream.error","message":"${msg}"}\n\n`))
        }
      }

      controller.enqueue(encoder.encode('data: {"event":"stream.complete"}\n\n'))
      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  })
}
