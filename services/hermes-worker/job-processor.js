import { nanoid } from 'nanoid'
import { intakeResearch } from './skills/intake-research.js'
import { conceptImages } from './skills/concept-images.js'
import { buildGeometry } from './skills/build-geometry.js'
import { dfmGate } from './skills/dfm-gate.js'
import { vendorQuote } from './skills/vendor-quote.js'
import { ledgerPayment } from './skills/ledger-payment.js'
import { vendorCheckoutGate, approveVendorCheckout } from './skills/vendor-checkout-gate.js'

const STAGE_HANDLERS = {
  research: intakeResearch,
  concept: conceptImages,
  geometry: buildGeometry,
  dfm: dfmGate,
  quote: vendorQuote,
  payment: ledgerPayment,
  checkout_gate: vendorCheckoutGate,
  // Human approval triggers this stage — issues Issuing card or SQLite record
  checkout_approve: async (db, orderId, payload) => approveVendorCheckout(db, orderId),
}

// ── Main dispatcher ──────────────────────────────────────────────────────────

export async function processJob(db, job) {
  const handler = STAGE_HANDLERS[job.stage]
  if (!handler) {
    markJobError(db, job, `Unknown stage: ${job.stage}`)
    return
  }

  console.log(`[job-processor] start job=${job.id} stage=${job.stage} order=${job.order_id}`)

  try {
    emitEvent(db, job.order_id, job.stage, 'started',
      `Hermes started ${job.stage}`, {})

    const payload = job.payload ? JSON.parse(job.payload) : {}
    const result = await handler(db, job.order_id, payload)

    db.prepare(`
      UPDATE jobs
      SET status = 'done', result = ?, completed_at = ?
      WHERE id = ?
    `).run(JSON.stringify(result), Date.now(), job.id)

    emitEvent(db, job.order_id, job.stage, 'completed',
      `Hermes completed ${job.stage}`, result ?? {})

    console.log(`[job-processor] done  job=${job.id} stage=${job.stage}`)
  } catch (err) {
    console.error(`[job-processor] error job=${job.id} stage=${job.stage}:`, err.message)
    markJobError(db, job, err.message)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function markJobError(db, job, error) {
  db.prepare(`
    UPDATE jobs SET status = 'error', error = ?, completed_at = ? WHERE id = ?
  `).run(error, Date.now(), job.id)

  db.prepare(`
    UPDATE orders SET state = 'error', error_msg = ?, updated_at = ? WHERE id = ?
  `).run(error, Date.now(), job.order_id)

  emitEvent(db, job.order_id, job.stage, 'error',
    `Hermes encountered an error in ${job.stage}: ${error}`, { error })
}

export function emitEvent(db, orderId, stage, event, message, data) {
  try {
    db.prepare(`
      INSERT INTO events (order_id, stage, event, message, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(orderId, stage, event, message, JSON.stringify(data ?? {}), Date.now())
  } catch (err) {
    console.error('[emitEvent] failed:', err.message)
  }
}

/**
 * Enqueue a new job for an order.
 * Returns the new job ID.
 */
export function enqueueJob(db, orderId, stage, payload = {}) {
  const id = nanoid()
  db.prepare(`
    INSERT INTO jobs (id, order_id, stage, status, payload, queued_at)
    VALUES (?, ?, ?, 'queued', ?, ?)
  `).run(id, orderId, stage, JSON.stringify(payload), Date.now())
  return id
}
