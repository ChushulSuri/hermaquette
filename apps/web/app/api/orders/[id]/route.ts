import { NextRequest, NextResponse } from 'next/server'
import { getDb, requireDemoToken } from '@/lib/db'
import fs from 'fs'
import path from 'path'

const HERMES_URL = (process.env.HERMES_GATEWAY_URL || 'http://hermes-agent:8642').replace('/v1', '')
const HERMES_KEY = process.env.HERMES_API_KEY || 'hermaquette-local'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params
  if (!id || id.length > 40) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 })
  }

  const db = getDb()

  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id) as Record<string, unknown> | undefined
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const spec = db.prepare('SELECT * FROM spec WHERE order_id=?').get(id) as Record<string, unknown> | undefined
  const ledger = db.prepare('SELECT * FROM ledger WHERE order_id=?').get(id) as Record<string, unknown> | undefined
  const vendorOrder = db.prepare('SELECT * FROM vendor_order WHERE order_id=? ORDER BY created_at DESC LIMIT 1').get(id) as Record<string, unknown> | undefined

  // Get recent events (last 50)
  const events = db.prepare(`
    SELECT id, stage, event, message, data, created_at
    FROM events WHERE order_id=?
    ORDER BY created_at DESC LIMIT 50
  `).all(id) as Array<Record<string, unknown>>

  // Extract concept images from events
  const conceptEvent = events.find(e => e.event === 'images_ready')
  let conceptImages: Array<{ id: string; url: string; source: string }> = []
  if (conceptEvent?.data) {
    try {
      const data = JSON.parse(conceptEvent.data as string)
      conceptImages = data.images || []
    } catch { /* ignore */ }
  }

  // Parse JSON fields
  if (spec?.provenance && typeof spec.provenance === 'string') {
    try { spec.provenance = JSON.parse(spec.provenance) } catch { /* keep as string */ }
  }
  if (spec?.dfm_report && typeof spec.dfm_report === 'string') {
    try { spec.dfm_report = JSON.parse(spec.dfm_report) } catch { /* keep as string */ }
  }

  // GLB path → servable URL for the viewer
  // Local /artifacts path → proxied via /api/artifacts
  // Remote https:// URL (fal.ai CDN) → passed through directly
  let glbUrl: string | null = null
  if (spec?.glb_path) {
    const glbPath = spec.glb_path as string
    if (glbPath.startsWith('http://') || glbPath.startsWith('https://')) {
      glbUrl = glbPath  // fal.ai / Meshy remote URL — pass through
    } else {
      const artifactsDir = process.env.ARTIFACTS_DIR || '/artifacts'
      if (glbPath.startsWith(artifactsDir)) {
        glbUrl = `/api/artifacts${glbPath.slice(artifactsDir.length)}`
      }
    }
  }

  return NextResponse.json({
    order,
    spec: spec || null,
    ledger: ledger || null,
    vendor_order: vendorOrder || null,
    concept_images: conceptImages,
    glb_url: glbUrl,
    events: events.slice(0, 20).map(e => ({
      ...e,
      data: e.data ? (() => { try { return JSON.parse(e.data as string) } catch { return e.data } })() : null
    })),
  })
}

// POST to approve a concept image direction or vendor checkout.
// No DEMO_TOKEN required: the order ID (nanoid-21) is the bearer.
// Approve actions are cheap state transitions — they don't trigger
// LLM calls or payments directly. (DEMO_TOKEN guards /api/orders POST
// and /api/checkout, which do trigger expensive/financial operations.)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {

  const { id } = params
  const db = getDb()

  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id) as { state: string; checkout_approved?: number; payment_confirmed_at?: number } | undefined
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  let body: { action?: string; image_id?: string; image_url?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.action === 'approve_concept') {
    if (!body.image_id) return NextResponse.json({ error: 'image_id required' }, { status: 400 })
    if (!body.image_url) return NextResponse.json({ error: 'image_url required' }, { status: 400 })

    // Idempotency: if already past concept state return current state
    if (order.state !== 'concept') {
      return NextResponse.json({ ok: true, state: order.state, idempotent: true })
    }

    // Download the concept image to artifacts volume so cad-dfm can read it locally
    const artifactsDir = process.env.ARTIFACTS_DIR || '/artifacts'
    const orderDir = path.join(artifactsDir, id)
    fs.mkdirSync(orderDir, { recursive: true })
    const conceptPath = path.join(orderDir, 'concept.jpg')

    try {
      const imgRes = await fetch(body.image_url)
      if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`)
      const buffer = Buffer.from(await imgRes.arrayBuffer())
      fs.writeFileSync(conceptPath, buffer)
    } catch (err) {
      console.error('[approve_concept] Failed to download concept image:', err)
      return NextResponse.json({ error: 'Could not download concept image' }, { status: 502 })
    }

    const now = Date.now()
    // Update spec with approved image
    db.prepare('UPDATE spec SET approved_image_id=?, updated_at=? WHERE order_id=?')
      .run(body.image_id, now, id)
    db.prepare('UPDATE orders SET state=?, updated_at=? WHERE id=?')
      .run('concept_approved', now, id)
    // Emit event so agent can see approval
    db.prepare("INSERT INTO events (order_id, stage, event, message, data, created_at) VALUES (?, 'concept', 'concept_approved', ?, ?, ?)")
      .run(id, 'Customer approved concept image', JSON.stringify({ image_id: body.image_id, image_url: body.image_url }), now)

    return NextResponse.json({ ok: true, state: 'concept_approved' })
  }

  if (body.action === 'approve_vendor_checkout') {
    // Idempotency: already approved (check the checkout_approved field, not order.state)
    if (order.checkout_approved) {
      return NextResponse.json({ ok: true, state: 'approving_checkout', idempotent: true })
    }

    // Require payment_confirmed_at — this is what enables the Approve button
    if (!order.payment_confirmed_at) {
      return NextResponse.json({ error: 'Payment not confirmed yet' }, { status: 400 })
    }

    const vendorOrder = db.prepare('SELECT * FROM vendor_order WHERE order_id=? ORDER BY created_at DESC LIMIT 1')
      .get(id) as { id: string; vendor_cost_cents: number; spend_cap_cents: number } | undefined
    if (!vendorOrder) return NextResponse.json({ error: 'No vendor order' }, { status: 404 })
    if (vendorOrder.vendor_cost_cents > vendorOrder.spend_cap_cents) {
      return NextResponse.json({ error: 'Cannot approve: over spend cap' }, { status: 400 })
    }

    // Atomic: flip checkout_approved=1 (idempotent)
    db.prepare('UPDATE orders SET checkout_approved = 1, updated_at = ? WHERE id = ? AND checkout_approved = 0')
      .run(Date.now(), id)

    // Dispatch Run 2
    const run2Input = `orderId: ${id}
Payment confirmed and spend approved by human. Please perform the governed vendor checkout:
1. Run: node /hermes/skills/hermaquette/vendor-checkout-gate/scripts/run.js ${id}
2. Then delegate Follow-up agent.`

    try {
      const runRes = await fetch(`${HERMES_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${HERMES_KEY}` },
        body: JSON.stringify({ input: run2Input }),
        signal: AbortSignal.timeout(10_000),
      })
      if (runRes.ok) {
        const runData = await runRes.json() as { run_id: string }
        db.prepare('UPDATE orders SET run2_run_id = ?, updated_at = ? WHERE id = ?')
          .run(runData.run_id, Date.now(), id)
      }
    } catch (err) {
      console.error('[approve] Run 2 dispatch failed:', err)
      // State is already approved — Run 2 can be retried
    }

    return NextResponse.json({ ok: true, state: 'approving_checkout' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
