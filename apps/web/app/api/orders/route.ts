import { NextRequest, NextResponse } from 'next/server'
import { getDb, requireDemoToken } from '@/lib/db'
import { nanoid } from 'nanoid'

const HERMES_URL = (process.env.HERMES_GATEWAY_URL || 'http://hermes-agent:8642').replace('/v1', '')
const HERMES_KEY = process.env.HERMES_API_KEY || 'hermaquette-local'

const MAX_DESCRIPTION_LENGTH = 2000
const MIN_DESCRIPTION_LENGTH = 10

export async function POST(req: NextRequest) {
  // DEMO_TOKEN gate — prevents accidental expensive runs
  if (!requireDemoToken(req)) {
    return NextResponse.json({ error: 'Invalid demo token' }, { status: 401 })
  }

  // Request size limit (intake body)
  const contentLength = req.headers.get('content-length')
  if (contentLength && parseInt(contentLength) > 10_000) {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }

  let body: { description?: string; material?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { description, material = 'pa12' } = body

  if (!description || description.trim().length < MIN_DESCRIPTION_LENGTH) {
    return NextResponse.json({ error: `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters` }, { status: 400 })
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json({ error: `Description too long (max ${MAX_DESCRIPTION_LENGTH} chars)` }, { status: 400 })
  }

  const validMaterials = ['pa12', 'resin', 'tpu']
  if (!validMaterials.includes(material)) {
    return NextResponse.json({ error: 'Invalid material' }, { status: 400 })
  }

  const db = getDb()
  const orderId = nanoid(21)  // unguessable, non-sequential
  const now = Date.now()

  db.prepare(`
    INSERT INTO orders (id, state, description, material, created_at, updated_at)
    VALUES (?, 'intake', ?, ?, ?, ?)
  `).run(orderId, description.trim(), material, now, now)

  // Call Hermes /v1/runs to start the agentic pipeline
  const runInput = `New order for Hermaquette manufacturing service.
Order ID: ${orderId}
Description: ${description.trim()}
Material: ${material}
Please process this order: generate concept images, get customer approval, then produce a 3D model and quote.`

  let runId: string | null = null
  try {
    const runRes = await fetch(`${HERMES_URL}/v1/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HERMES_KEY}`,
      },
      body: JSON.stringify({ input: runInput }),
      signal: AbortSignal.timeout(10_000),
    })
    if (runRes.ok) {
      const runData = await runRes.json() as { run_id: string }
      runId = runData.run_id
      db.prepare('UPDATE orders SET run_id = ?, updated_at = ? WHERE id = ?')
        .run(runId, now, orderId)
    } else {
      // Gateway unreachable — save order with error state
      db.prepare("UPDATE orders SET state = 'error', error_msg = ?, updated_at = ? WHERE id = ?")
        .run(`Hermes gateway HTTP ${runRes.status}`, now, orderId)
      db.prepare("INSERT INTO events (order_id, stage, event, message, data, created_at) VALUES (?, 'orchestrator', 'error', ?, ?, ?)")
        .run(orderId, 'Hermes agent unavailable — please retry', JSON.stringify({ error: `HTTP ${runRes.status}` }), now)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    db.prepare("UPDATE orders SET state = 'error', error_msg = ?, updated_at = ? WHERE id = ?")
      .run(`Hermes gateway unreachable: ${msg}`, now, orderId)
    db.prepare("INSERT INTO events (order_id, stage, event, message, data, created_at) VALUES (?, 'orchestrator', 'error', ?, ?, ?)")
      .run(orderId, 'Hermes agent unavailable — please retry', JSON.stringify({ error: msg }), now)
  }

  // Emit attribution event
  db.prepare("INSERT INTO events (order_id, stage, event, message, data, created_at) VALUES (?, 'orchestrator', 'started', ?, ?, ?)")
    .run(orderId, 'Hermaquette is analyzing your request', JSON.stringify({ agent: 'Hermaquette', run_id: runId }), now)

  return NextResponse.json({ id: orderId, state: 'intake', run_id: runId }, { status: 201 })
}
