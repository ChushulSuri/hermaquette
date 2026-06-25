/**
 * Spend adapter for governed vendor checkout (U11).
 *
 * Primary path:  Stripe Issuing test-mode virtual card with spending_limits.
 * Fallback path: SQLite approval record (same gate semantics, no card issued).
 *
 * IMPORTANT: The card is NEVER charged — no live Sculpteo purchase is made.
 * ship_to_status=address_pending gates execution; executed is always false here.
 *
 * @typedef {Object} SpendApprovalRequest
 * @property {string} order_id          - Hermaquette order UUID
 * @property {number} vendor_cost_cents - Amount to authorize
 * @property {string} vendor_order_id   - vendor_order table primary key
 *
 * @typedef {Object} SpendApprovalResult
 * @property {'approved'|'blocked'} status
 * @property {'issuing'|'sqlite'}   spend_path
 * @property {string}  [card_id]
 * @property {string}  [card_last4]
 * @property {number}  spend_cap_cents
 * @property {number}  vendor_cost_cents
 * @property {false}   executed          - Always false: no live purchase is made
 * @property {string}  [reason]
 */

import Stripe from 'stripe'

const SPEND_CAP_CENTS = parseInt(process.env.SPEND_CAP_CENTS || '5000', 10)

/**
 * Issue a governed spend approval for a vendor order.
 * @param {import('better-sqlite3').Database} db
 * @param {SpendApprovalRequest} req
 * @returns {Promise<SpendApprovalResult>}
 */
export async function issueSpendApproval(db, req) {
  const { order_id, vendor_cost_cents, vendor_order_id } = req

  // ── Gate: enforce spend cap ─────────────────────────────────────────────────
  if (vendor_cost_cents > SPEND_CAP_CENTS) {
    console.warn(
      `[spend] BLOCKED order=${order_id} cost=${vendor_cost_cents} cap=${SPEND_CAP_CENTS}`
    )
    return {
      status: 'blocked',
      spend_path: 'sqlite',
      spend_cap_cents: SPEND_CAP_CENTS,
      vendor_cost_cents,
      executed: false,
      reason: `Cost €${(vendor_cost_cents / 100).toFixed(2)} exceeds spend cap €${(SPEND_CAP_CENTS / 100).toFixed(2)}`,
    }
  }

  // ── Idempotency: don't issue a second card for the same order ───────────────
  const existing = db
    .prepare('SELECT issuing_card_id FROM vendor_order WHERE order_id=? AND issuing_card_id IS NOT NULL')
    .get(order_id)

  if (existing?.issuing_card_id) {
    console.log(`[spend] Idempotent: card ${existing.issuing_card_id} already issued for order ${order_id}`)
    return {
      status: 'approved',
      spend_path: 'issuing',
      card_id: existing.issuing_card_id,
      spend_cap_cents: SPEND_CAP_CENTS,
      vendor_cost_cents,
      executed: false,
    }
  }

  // ── Primary path: Stripe Issuing virtual card ───────────────────────────────
  if (process.env.STRIPE_ISSUING_ENABLED === 'true' && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2024-04-10',
      })

      const card = await stripe.issuing.cards.create({
        currency: 'usd',
        type: 'virtual',
        spending_controls: {
          spending_limits: [
            {
              amount: SPEND_CAP_CENTS,
              interval: 'per_authorization',
            },
          ],
          // Restrict card to shipping/fulfillment merchant category only
          allowed_categories: ['shipping_and_delivery'],
        },
        metadata: {
          order_id,
          hermaquette: 'true',
          executed: 'false',
          spend_cap: String(SPEND_CAP_CENTS),
          note: 'DEMO: card never charged — no live vendor purchase made',
        },
      })

      // Persist card ID for idempotency and audit trail
      db.prepare(`
        UPDATE vendor_order
        SET issuing_card_id=?, spend_path='issuing', status='approved', approved_at=?
        WHERE id=?
      `).run(card.id, Date.now(), vendor_order_id)

      console.log(`[spend] Issued Stripe card ${card.id} (last4=${card.last4}) for order ${order_id}`)

      return {
        status: 'approved',
        spend_path: 'issuing',
        card_id: card.id,
        card_last4: card.last4,
        spend_cap_cents: SPEND_CAP_CENTS,
        vendor_cost_cents,
        executed: false,
      }
    } catch (err) {
      console.warn('[spend] Stripe Issuing failed, falling back to SQLite:', err.message)
    }
  }

  // ── Fallback path: SQLite governed approval record ──────────────────────────
  db.prepare(`
    UPDATE vendor_order
    SET spend_path='sqlite', status='approved', approved_at=?
    WHERE id=?
  `).run(Date.now(), vendor_order_id)

  console.log(`[spend] SQLite approval record for order ${order_id} (Stripe Issuing unavailable)`)

  return {
    status: 'approved',
    spend_path: 'sqlite',
    spend_cap_cents: SPEND_CAP_CENTS,
    vendor_cost_cents,
    executed: false,
    reason: 'Stripe Issuing unavailable — governed SQLite approval record used instead',
  }
}
