/**
 * vendor-checkout-gate skill
 *
 * Stage: checkout_gate
 *
 * Governance gate: human-in-the-loop before any real vendor spend.
 *
 * 1. Checks vendor_cost_cents against SPEND_CAP_CENTS (default $50)
 * 2. If over cap: blocks, requires human approval out-of-band
 * 3. If within cap: creates vendor_order row with requires_human_approval=1
 *    and emits awaiting_approval event — the web API /approve endpoint calls
 *    approveVendorCheckout() to proceed
 *
 * approveVendorCheckout() (exported for the web API):
 *    - Optionally issues a Stripe Issuing virtual card (STRIPE_ISSUING_ENABLED=true)
 *    - Updates vendor_order.status → 'approved'
 *    - Updates order.state → 'checkout_approved'
 *    - NEVER actually charges or submits — that requires a separate explicit step
 */
import { nanoid } from 'nanoid'
import Stripe from 'stripe'
import { emitEvent } from '../job-processor.js'

const SPEND_CAP_CENTS = parseInt(process.env.SPEND_CAP_CENTS || '5000')

// ── Main stage handler ────────────────────────────────────────────────────────

export async function vendorCheckoutGate(db, orderId, _payload) {
  const ledger = db.prepare('SELECT * FROM ledger WHERE order_id = ?').get(orderId)
  if (!ledger) throw new Error(`No ledger row found for order ${orderId}`)

  const vendorCost = ledger.vendor_cost_cents

  emitEvent(db, orderId, 'checkout_gate', 'progress',
    `Hermes is evaluating governed vendor checkout (spend cap: $${(SPEND_CAP_CENTS / 100).toFixed(2)})…`,
    { vendor_cost: vendorCost, spend_cap: SPEND_CAP_CENTS })

  if (vendorCost > SPEND_CAP_CENTS) {
    return handleOverCap(db, orderId, vendorCost)
  }

  return handleWithinCap(db, orderId, vendorCost)
}

// ── Outcome handlers ──────────────────────────────────────────────────────────

function handleOverCap(db, orderId, vendorCost) {
  const vendorOrderId = nanoid()
  db.prepare(`
    INSERT INTO vendor_order (id, order_id, vendor_cost_cents, spend_cap_cents, status, created_at)
    VALUES (?, ?, ?, ?, 'blocked', ?)
  `).run(vendorOrderId, orderId, vendorCost, SPEND_CAP_CENTS, Date.now())

  db.prepare(`UPDATE orders SET state = 'checkout_blocked', updated_at = ? WHERE id = ?`)
    .run(Date.now(), orderId)

  emitEvent(db, orderId, 'checkout_gate', 'blocked',
    `Hermes blocked vendor checkout: cost $${(vendorCost / 100).toFixed(2)} exceeds spend cap $${(SPEND_CAP_CENTS / 100).toFixed(2)}. Human approval required.`,
    { vendor_cost: vendorCost, spend_cap: SPEND_CAP_CENTS, vendor_order_id: vendorOrderId })

  console.warn(`[checkout-gate] BLOCKED order=${orderId} cost=${vendorCost} cap=${SPEND_CAP_CENTS}`)
  return { status: 'blocked', reason: 'over_spend_cap', vendor_order_id: vendorOrderId }
}

function handleWithinCap(db, orderId, vendorCost) {
  const vendorOrderId = nanoid()
  db.prepare(`
    INSERT INTO vendor_order (
      id, order_id, vendor_cost_cents, spend_cap_cents,
      requires_human_approval, status, created_at
    ) VALUES (?, ?, ?, ?, 1, 'pending', ?)
  `).run(vendorOrderId, orderId, vendorCost, SPEND_CAP_CENTS, Date.now())

  db.prepare(`UPDATE orders SET state = 'checkout_pending_approval', updated_at = ? WHERE id = ?`)
    .run(Date.now(), orderId)

  emitEvent(db, orderId, 'checkout_gate', 'awaiting_approval',
    'Hermes is awaiting human approval to proceed with vendor checkout. Review and approve the order.',
    { vendor_order_id: vendorOrderId, vendor_cost: vendorCost, spend_cap: SPEND_CAP_CENTS })

  console.log(`[checkout-gate] PENDING_APPROVAL order=${orderId} vendorOrder=${vendorOrderId}`)
  return { status: 'pending_approval', vendor_order_id: vendorOrderId }
}

// ── Exported for the web API /orders/:id/approve endpoint ────────────────────

/**
 * Approve a vendor checkout that passed the spend gate.
 * Optionally issues a Stripe Issuing virtual card for the spend.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} orderId
 * @returns {Promise<{status: string, spend_path: string, card_id: string|null, executed: boolean}>}
 */
export async function approveVendorCheckout(db, orderId) {
  const vendorOrder = db.prepare(
    'SELECT * FROM vendor_order WHERE order_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(orderId)

  if (!vendorOrder) throw new Error(`No vendor_order found for order ${orderId}`)
  if (vendorOrder.status === 'blocked') throw new Error('Cannot approve: vendor order is blocked (over spend cap)')
  if (vendorOrder.status === 'approved') throw new Error('Vendor order already approved')

  let cardId = null
  let spendPath = 'sqlite'

  // Read ledger to get the order currency (Sculpteo quotes in EUR)
  const ledger = db.prepare('SELECT currency FROM ledger WHERE order_id = ?').get(orderId)
  const issuingCurrency = (ledger?.currency || 'usd').toLowerCase()

  if (process.env.STRIPE_ISSUING_ENABLED === 'true' && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

      // Stripe Issuing requires a cardholder — create a minimal one per order
      const cardholder = await stripe.issuing.cardholders.create({
        name: 'Hermaquette Demo',
        email: 'demo@hermaquette.ai',
        type: 'individual',
        billing: {
          address: {
            line1: '123 Hermes St',
            city: 'San Francisco',
            state: 'CA',
            postal_code: '94101',
            country: 'US',
          },
        },
        metadata: { order_id: orderId, hermaquette: 'true' },
      })

      // Test-mode only: issue a virtual card scoped to shipping merchants
      const card = await stripe.issuing.cards.create({
        cardholder: cardholder.id,
        currency: issuingCurrency,
        type: 'virtual',
        spending_controls: {
          spending_limits: [{
            amount: SPEND_CAP_CENTS,
            interval: 'per_authorization',
          }],
          allowed_categories: ['shipping_and_delivery', 'mail_order'],
        },
        metadata: {
          order_id: orderId,
          hermaquette: 'true',
          executed: 'false',
          vendor_order_id: vendorOrder.id,
        },
      })
      cardId = card.id
      spendPath = 'issuing'
      console.log(`[checkout-gate] Stripe Issuing card created: ${cardId}`)
    } catch (err) {
      console.warn('[checkout-gate] Stripe Issuing failed, falling back to sqlite record:', err.message)
    }
  }

  db.prepare(`
    UPDATE vendor_order
    SET status = 'approved', approved_at = ?, issuing_card_id = ?, spend_path = ?, executed = 0
    WHERE id = ?
  `).run(Date.now(), cardId, spendPath, vendorOrder.id)

  db.prepare(`UPDATE orders SET state = 'checkout_approved', updated_at = ? WHERE id = ?`)
    .run(Date.now(), orderId)

  emitEvent(db, orderId, 'checkout_gate', 'approved',
    `Vendor checkout approved. Spend path: ${spendPath}.`,
    { spend_path: spendPath, card_id: cardId, executed: false })

  console.log(`[checkout-gate] APPROVED order=${orderId} spendPath=${spendPath} cardId=${cardId}`)

  return { status: 'approved', spend_path: spendPath, card_id: cardId, executed: false }
}
