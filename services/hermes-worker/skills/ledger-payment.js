/**
 * ledger-payment skill
 *
 * Stage: payment
 *
 * Called by the web API after Stripe fires a checkout.session.completed webhook.
 * Payload: { session_id, payment_status }
 *
 * 1. Verifies payment_status === 'paid'
 * 2. Records Stripe session ID on the ledger row
 * 3. Updates order state → 'paid'
 * 4. Enqueues checkout_gate
 */
import { nanoid } from 'nanoid'
import { emitEvent } from '../job-processor.js'

export async function ledgerPayment(db, orderId, payload) {
  const { session_id, payment_status } = payload

  if (!session_id) throw new Error('payload.session_id is required')
  if (payment_status !== 'paid') {
    throw new Error(`Payment not confirmed: received status '${payment_status}'`)
  }

  const ledger = db.prepare('SELECT * FROM ledger WHERE order_id = ?').get(orderId)
  if (!ledger) throw new Error(`No ledger row found for order ${orderId}`)

  db.prepare(`
    UPDATE ledger
    SET stripe_session_id = ?, stripe_payment_status = 'paid', updated_at = ?
    WHERE order_id = ?
  `).run(session_id, Date.now(), orderId)

  db.prepare(`UPDATE orders SET state = 'paid', updated_at = ? WHERE id = ?`)
    .run(Date.now(), orderId)

  emitEvent(db, orderId, 'payment', 'confirmed',
    'Hermes confirmed payment — initiating vendor checkout gate…', { session_id })

  // Enqueue vendor checkout gate
  const jobId = nanoid()
  db.prepare(`
    INSERT INTO jobs (id, order_id, stage, status, payload, queued_at)
    VALUES (?, ?, 'checkout_gate', 'queued', '{}', ?)
  `).run(jobId, orderId, Date.now())

  console.log(`[ledger-payment] order=${orderId} session=${session_id} nextJob=${jobId}`)

  return { status: 'paid', session_id, next_stage: 'checkout_gate' }
}
