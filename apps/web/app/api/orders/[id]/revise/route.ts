import { NextRequest, NextResponse } from 'next/server'
import { getDb, requireDemoToken } from '@/lib/db'
import { hasValidAccessCookie } from '@/lib/auth'

const HERMES_URL = (process.env.HERMES_GATEWAY_URL || 'http://hermes-agent:8642').replace('/v1', '')
const HERMES_KEY = process.env.HERMES_API_KEY || 'hermaquette-local'
const MAX_REVISIONS = 3

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!requireDemoToken(req)) {
    return NextResponse.json({ error: 'Invalid demo token' }, { status: 401 })
  }
  if (!(await hasValidAccessCookie(req))) {
    return NextResponse.json({ error: 'Access code required' }, { status: 401 })
  }

  const { id: orderId } = params

  let body: { prompt?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { prompt } = body
  if (!prompt || prompt.trim().length < 5) {
    return NextResponse.json({ error: 'Revision prompt must be at least 5 characters' }, { status: 400 })
  }

  const db = getDb()
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as {
    state: string
    revision_n: number
    description: string
  } | undefined

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Only allow revisions in concept state
  if (order.state !== 'concept') {
    return NextResponse.json({ error: 'Revisions only available in concept state' }, { status: 400 })
  }

  // Atomic cap-and-increment: only bump revision_n if still under the cap AND in
  // concept state. changes===0 means the cap was hit (or a concurrent request won
  // the race) → reject. This keeps the 3-revision spend cap a hard guarantee (D6).
  const now = Date.now()
  const bumped = db.prepare(
    'UPDATE orders SET revision_n = revision_n + 1, updated_at = ? WHERE id = ? AND state = ? AND revision_n < ?'
  ).run(now, orderId, 'concept', MAX_REVISIONS)

  if (bumped.changes === 0) {
    const cur = db.prepare('SELECT revision_n FROM orders WHERE id = ?').get(orderId) as { revision_n: number } | undefined
    return NextResponse.json({
      error: `Maximum ${MAX_REVISIONS} revisions reached`,
      revision_n: cur?.revision_n ?? MAX_REVISIONS,
    }, { status: 400 })
  }

  const newRevisionN = (db.prepare('SELECT revision_n FROM orders WHERE id = ?').get(orderId) as { revision_n: number }).revision_n

  // Emit revision event
  db.prepare("INSERT INTO events (order_id, stage, event, message, data, created_at) VALUES (?, 'concept', 'revision_requested', ?, ?, ?)")
    .run(orderId, `Revision ${newRevisionN}: ${prompt.trim()}`, JSON.stringify({ revision_n: newRevisionN, prompt: prompt.trim() }), now)

  // Dispatch a Hermes run for the revision
  const runInput = `Revision ${newRevisionN} for order ${orderId}.
Original description: ${order.description}
Revision instruction: ${prompt.trim()}
Generate new concept images incorporating this revision.`

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
    }
  } catch (err: unknown) {
    console.warn('[revise] Hermes run dispatch failed:', err)
  }

  return NextResponse.json({
    ok: true,
    revision_n: newRevisionN,
    remaining: MAX_REVISIONS - newRevisionN,
    run_id: runId,
  })
}
