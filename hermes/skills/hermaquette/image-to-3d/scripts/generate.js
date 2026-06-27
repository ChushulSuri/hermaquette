#!/usr/bin/env node
/**
 * image-to-3d skill script.
 * Reads image_url from SQLite by orderId (no shell interpolation).
 * Usage: node generate.js <orderId>
 * Exit: 0 on success, 1 on budget-exhausted or fatal error
 */
import { generate3d, BudgetExhaustedError } from '/app/packages/image3d/adapter.js'
import { checkBudget } from '/app/packages/image3d/budget.js'
import { getDb, emitEvent, upsertSpec, writeDelegation } from '../../_shared/db.js'

const orderId = process.argv[2]
const parentRunId = process.argv[3] || process.env.HERMES_RUN_ID || ''

if (!orderId) {
  console.error(JSON.stringify({ error: 'Usage: generate.js <orderId> [parentRunId]' }))
  process.exit(1)
}

const db = getDb()

// N1: proof-of-agency — first action before any external call
writeDelegation(db, orderId, parentRunId, 'sculptor', 'started')

// Read image_url from spec table — never from argv (prevents shell injection)
const spec = db.prepare('SELECT * FROM spec WHERE order_id = ?').get(orderId)
if (!spec) {
  console.error(JSON.stringify({ error: `Order ${orderId} has no spec record — run concept-images first` }))
  process.exit(1)
}

const image_url = spec.approved_image_url
if (!image_url) {
  console.error(JSON.stringify({ error: `Order ${orderId} has no approved_image_url — run concept-approve first` }))
  process.exit(1)
}

const description = spec.description || ''

// Pre-call budget check
const budget = checkBudget(0.80) // Conservative estimate for both passes
if (!budget.allowed) {
  db.prepare("UPDATE orders SET state = 'error', updated_at = ? WHERE id = ?").run(Date.now(), orderId)
  emitEvent(db, orderId, 'image-to-3d', 'geometry_failed',
    'Budget exhausted before 3D generation', { reason: budget.reason, current: budget.current, cap: budget.cap })
  console.log(JSON.stringify({
    status: 'budget_exhausted',
    error: budget.reason,
    current_spend: budget.current,
    cap: budget.cap,
  }))
  process.exit(1)
}

try {
  const result = await generate3d(image_url, {
    orderId,
    dry_run: false,
  })

  const { glb_url, stl_url, geometry_hash } = result

  upsertSpec(db, orderId, {
    glb_path: glb_url,
    stl_path: stl_url,
    provenance: JSON.stringify({
      geometry_hash,
      image_url,
      model_used: result.model_used,
      provider: result.provider,
      cost_usd: result.cost_usd,
      generated_at: Date.now(),
    }),
  })

  emitEvent(db, orderId, 'image-to-3d', 'geometry_ready',
    'Sculptor generated 3D geometry from concept image',
    { glb_url, stl_url, geometry_hash })

  console.log(JSON.stringify({ status: 'ok', glb_url, stl_url, geometry_hash, ...result }))
  process.exit(0)
} catch (err) {
  db.prepare("UPDATE orders SET state = 'error', updated_at = ? WHERE id = ?").run(Date.now(), orderId)
  if (err instanceof BudgetExhaustedError) {
    emitEvent(db, orderId, 'image-to-3d', 'geometry_failed', 'Budget exhausted', {})
    console.log(JSON.stringify({ status: 'budget_exhausted', error: err.message }))
    process.exit(1)
  } else {
    emitEvent(db, orderId, 'image-to-3d', 'geometry_failed',
      `3D generation failed: ${err.message}`, { error: err.message })
    console.log(JSON.stringify({ status: 'error', error: err.message }))
    process.exit(1)
  }
}
