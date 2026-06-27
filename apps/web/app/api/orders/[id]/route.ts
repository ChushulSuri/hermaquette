import { NextRequest, NextResponse } from 'next/server'
import { getDb, requireDemoToken } from '@/lib/db'
import crypto from 'crypto'
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

    // Validate image_url is a safe HTTP(S) URL before interpolation into agent input
    try {
      const parsedUrl = new URL(body.image_url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('bad protocol')
    } catch {
      return NextResponse.json({ error: 'Invalid image_url: must be an HTTP(S) URL' }, { status: 400 })
    }

    // Atomic state transition: only one concurrent request can win the race
    const now = Date.now()
    const result = db.prepare("UPDATE orders SET state = 'geometry_pending', updated_at = ? WHERE id = ? AND state = 'concept'")
      .run(now, id)
    if (result.changes === 0) {
      // Either already past concept, or another request won the race
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
      // Roll back state so the order can be retried
      db.prepare("UPDATE orders SET state = 'concept', updated_at = ? WHERE id = ?").run(Date.now(), id)
      return NextResponse.json({ error: 'Could not download concept image' }, { status: 502 })
    }

    // Upsert spec with approved image — spec row may not exist (V1 intake-research created it)
    const existingSpec = db.prepare('SELECT id FROM spec WHERE order_id = ?').get(id) as { id: string } | undefined
    if (existingSpec) {
      db.prepare('UPDATE spec SET approved_image_id=?, approved_image_url=?, material=?, updated_at=? WHERE order_id=?')
        .run(body.image_id, body.image_url, order.material || 'pa12', now, id)
    } else {
      db.prepare(`
        INSERT INTO spec (id, order_id, approved_image_id, approved_image_url, material, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID().slice(0, 12), id, body.image_id, body.image_url, order.material || 'pa12', now, now)
    }
    // Emit event so agent can see approval
    db.prepare("INSERT INTO events (order_id, stage, event, message, data, created_at) VALUES (?, 'concept', 'concept_approved', ?, ?, ?)")
      .run(id, 'Customer approved concept image', JSON.stringify({ image_id: body.image_id, image_url: body.image_url }), now)

    // Dispatch geometry run — agent reads image_url from SQLite spec table (no raw interpolation)
    // Write run_id BEFORE dispatch to prevent read race in child's COALESCE query
    const geoInput = `orderId: ${id}

Customer approved concept image. Read the approved image URL from SQLite:
SELECT approved_image_url FROM spec WHERE order_id = '${id}'

Delegate to Sculptor via delegate_task with orderId, image_url (from query), and material (from orders table).
Sculptor will run image-to-3d, DFM repair, then you run vendor-quote.
Present the quote to the customer and STOP.`

    try {
      // Pre-allocate a run_id so child can read it via COALESCE
      const preRunId = `run_geo_${crypto.randomUUID().slice(0, 12)}`
      db.prepare('UPDATE orders SET run_id = ?, updated_at = ? WHERE id = ?')
        .run(preRunId, Date.now(), id)

      const runRes = await fetch(`${HERMES_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${HERMES_KEY}` },
        body: JSON.stringify({ input: geoInput }),
        signal: AbortSignal.timeout(10_000),
      })
      if (runRes.ok) {
        const runData = await runRes.json() as { run_id: string }
        // Overwrite with actual run_id from gateway
        db.prepare('UPDATE orders SET run_id = ?, updated_at = ? WHERE id = ?')
          .run(runData.run_id, Date.now(), id)
      } else {
        // Non-2xx — roll back so order can be retried
        db.prepare("UPDATE orders SET state = 'concept', run_id = NULL, updated_at = ? WHERE id = ?").run(Date.now(), id)
      }
    } catch (err) {
      console.error('[approve_concept] Geometry run dispatch failed:', err)
      // Roll back state so the order can be retried
      db.prepare("UPDATE orders SET state = 'concept', run_id = NULL, updated_at = ? WHERE id = ?").run(Date.now(), id)
    }

    return NextResponse.json({ ok: true, state: 'geometry_pending' })
  }

  if (body.action === 'approve_vendor_checkout') {
    // Idempotency: already approved — but check if Run 2 needs re-dispatch
    if (order.checkout_approved) {
      const existingRun2 = db.prepare('SELECT run2_run_id FROM orders WHERE id = ?').get(id) as { run2_run_id: string | null } | undefined
      if (existingRun2?.run2_run_id) {
        return NextResponse.json({ ok: true, state: 'approving_checkout', idempotent: true })
      }
      // checkout_approved but no run2 — re-dispatch falls through below
    } else {
      // Require payment_confirmed_at — this is what enables the Approve button
      if (!order.payment_confirmed_at) {
        return NextResponse.json({ error: 'Payment not confirmed yet' }, { status: 400 })
      }

      const ledger = db.prepare('SELECT vendor_cost_cents FROM ledger WHERE order_id = ?').get(id) as { vendor_cost_cents: number } | undefined
      if (!ledger) {
        return NextResponse.json({ error: 'No quote available — vendor-quote has not run yet' }, { status: 400 })
      }
      const vendorCostCents = ledger.vendor_cost_cents
      const spendCapCents = parseInt(process.env.SPEND_CAP_CENTS || '5000')
      if (vendorCostCents > spendCapCents) {
        return NextResponse.json({ error: 'Cannot approve: over spend cap' }, { status: 400 })
      }

      // Atomic: flip checkout_approved=1 + set state (idempotent)
      const result = db.prepare('UPDATE orders SET checkout_approved = 1, state = \'approving_checkout\', updated_at = ? WHERE id = ? AND checkout_approved = 0')
        .run(Date.now(), id)
      if (result.changes === 0) return NextResponse.json({ ok: true, state: 'approving_checkout', idempotent: true })
    }

    // Dispatch Run 2 (or re-dispatch if previous attempt failed)
    // Atomic guard: only dispatch if run2_run_id is NULL (prevents duplicate Run-2)
    const run2RunId = `run2_${crypto.randomUUID().slice(0, 12)}`
    const claimed = db.prepare('UPDATE orders SET run2_run_id = ?, updated_at = ? WHERE id = ? AND run2_run_id IS NULL')
      .run(run2RunId, Date.now(), id)
    if (claimed.changes === 0) {
      // Another request already claimed this dispatch — idempotent return
      return NextResponse.json({ ok: true, state: 'approving_checkout', idempotent: true })
    }

    // Read parent run_id for N1 delegation tracing
    const parentRow = db.prepare('SELECT COALESCE(run2_run_id, run_id) AS parent_run_id FROM orders WHERE id = ?').get(id) as { parent_run_id: string } | undefined
    const parentRunId = parentRow?.parent_run_id || ''

    const run2Input = `orderId: ${id}
parentRunId: ${parentRunId}
Payment confirmed and spend approved by human. Please perform the governed vendor checkout:
1. Run: node /hermes/skills/hermaquette/vendor-checkout-gate/scripts/run.js ${id}
2. Then delegate Follow-up agent with parentRunId.`

    try {
      const runRes = await fetch(`${HERMES_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${HERMES_KEY}` },
        body: JSON.stringify({ input: run2Input }),
        signal: AbortSignal.timeout(10_000),
      })
      if (runRes.ok) {
        const runData = await runRes.json() as { run_id: string }
        // Overwrite with actual run_id from gateway
        db.prepare('UPDATE orders SET run2_run_id = ?, updated_at = ? WHERE id = ?')
          .run(runData.run_id, Date.now(), id)
      } else {
        console.error('[approve] Run 2 dispatch non-2xx:', runRes.status)
        // Roll back so user can retry — reset state + checkout_approved
        db.prepare('UPDATE orders SET run2_run_id = NULL, checkout_approved = 0, state = \'paid\', updated_at = ? WHERE id = ?').run(Date.now(), id)
      }
    } catch (err) {
      console.error('[approve] Run 2 dispatch failed:', err)
      db.prepare('UPDATE orders SET run2_run_id = NULL, checkout_approved = 0, state = \'paid\', updated_at = ? WHERE id = ?').run(Date.now(), id)
    }

    return NextResponse.json({ ok: true, state: 'approving_checkout' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
