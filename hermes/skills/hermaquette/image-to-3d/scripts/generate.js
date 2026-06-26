#!/usr/bin/env node
/**
 * image-to-3d skill script.
 * Called by the Sculptor agent via delegate_task.
 * Outputs result JSON to stdout.
 *
 * Usage: node generate.js <orderId> <image_url> [parentRunId]
 * Exit: 0 on success, 1 on budget-exhausted or fatal error
 */
import { generate3d, BudgetExhaustedError } from '/app/packages/image3d/adapter.js'
import { checkBudget } from '/app/packages/image3d/budget.js'
import { getDb, emitEvent, upsertSpec, writeDelegation } from '../_shared/db.js'

const orderId = process.argv[2]
const image_url = process.argv[3]
const parentRunId = process.argv[4] || process.env.HERMES_RUN_ID || ''

if (!orderId || !image_url) {
  console.error(JSON.stringify({ error: 'Usage: generate.js <orderId> <image_url> [parentRunId]' }))
  process.exit(1)
}

const db = getDb()

// N1: proof-of-agency — first action before any external call
writeDelegation(db, orderId, parentRunId, 'sculptor', 'started')

// Pre-call budget check
const budget = checkBudget(0.80) // Conservative estimate for both passes
if (!budget.allowed) {
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
