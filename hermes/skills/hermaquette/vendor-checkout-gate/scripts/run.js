#!/usr/bin/env node
/**
 * vendor-checkout-gate skill script (B2 safety gate)
 *
 * Governance gate before any real vendor spend.
 * Fail-closed: ALL three conditions must be true to proceed.
 *   1. payment_confirmed_at IS NOT NULL (payment confirmed)
 *   2. checkout_approved = 1 (human approved — not checkout_pending_approval)
 *   3. vendor_cost_cents <= SPEND_CAP_CENTS (within cap)
 *
 * If any condition fails: write checkout_blocked event + exit 1 (no Issuing card created)
 * If all pass: demonstrate (never execute) the test Issuing card creation.
 *
 * Usage: node run.js <orderId>
 * Output: JSON to stdout
 * Exit: 0 on pass, 1 on gate failure
 */
import { nanoid } from 'nanoid'
import Stripe from 'stripe'
import { getDb, emitEvent } from '../../_shared/db.js'

const SPEND_CAP_CENTS = parseInt(process.env.SPEND_CAP_CENTS || '5000')

const orderId = process.argv[2]
if (!orderId) {
  console.error(JSON.stringify({ error: 'orderId required' }))
  process.exit(1)
}

const db = getDb()

const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
if (!order) {
  console.error(JSON.stringify({ error: `Order ${orderId} not found` }))
  process.exit(1)
}

const ledger = db.prepare('SELECT * FROM ledger WHERE order_id = ?').get(orderId)
if (!ledger) {
  console.error(JSON.stringify({ error: `No ledger row found for order ${orderId}` }))
  process.exit(1)
}

const vendorCost = ledger.vendor_cost_cents

emitEvent(db, orderId, 'checkout_gate', 'progress',
  `Hermes is evaluating governed vendor checkout (spend cap: $${(SPEND_CAP_CENTS / 100).toFixed(2)})…`,
  { vendor_cost: vendorCost, spend_cap: SPEND_CAP_CENTS })

// ── Fail-closed gate: ALL conditions must be true ─────────────────────────────

// Condition 1: payment_confirmed_at IS NOT NULL
if (!order.payment_confirmed_at) {
  db.prepare("UPDATE orders SET state = 'checkout_blocked', updated_at = ? WHERE id = ?").run(Date.now(), orderId)
  emitEvent(db, orderId, 'checkout_gate', 'checkout_blocked',
    'Checkout gate blocked: payment not yet confirmed',
    { reason: 'payment_not_confirmed', vendor_cost: vendorCost })
  console.log(JSON.stringify({
    status: 'blocked',
    reason: 'payment_not_confirmed',
    message: 'payment_confirmed_at is NULL — payment must be confirmed before vendor spend',
  }))
  process.exit(1)
}

// Condition 2: checkout_approved = 1 (state must be 'checkout_approved', not 'checkout_pending_approval')
if (!order.checkout_approved) {
  db.prepare("UPDATE orders SET state = 'checkout_blocked', updated_at = ? WHERE id = ?").run(Date.now(), orderId)
  emitEvent(db, orderId, 'checkout_gate', 'checkout_blocked',
    'Checkout gate blocked: human approval not yet granted',
    { reason: 'approval_pending', order_state: order.state, vendor_cost: vendorCost })
  console.log(JSON.stringify({
    status: 'blocked',
    reason: 'approval_pending',
    message: 'checkout_approved = 0 — human must approve before vendor spend',
  }))
  process.exit(1)
}

// Condition 3: vendor_cost_cents <= SPEND_CAP_CENTS
if (vendorCost > SPEND_CAP_CENTS) {
  db.prepare("UPDATE orders SET state = 'checkout_blocked', updated_at = ? WHERE id = ?").run(Date.now(), orderId)
  emitEvent(db, orderId, 'checkout_gate', 'checkout_blocked',
    `Checkout gate blocked: cost $${(vendorCost / 100).toFixed(2)} exceeds spend cap $${(SPEND_CAP_CENTS / 100).toFixed(2)}`,
    { reason: 'over_spend_cap', vendor_cost: vendorCost, spend_cap: SPEND_CAP_CENTS })
  console.log(JSON.stringify({
    status: 'blocked',
    reason: 'over_spend_cap',
    vendor_cost_cents: vendorCost,
    spend_cap_cents: SPEND_CAP_CENTS,
  }))
  process.exit(1)
}

// ── All conditions passed — demonstrate Stripe Issuing card (never execute) ───

let cardId = null
let spendPath = 'sqlite'

if (process.env.STRIPE_ISSUING_ENABLED === 'true' && process.env.STRIPE_SECRET_KEY) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

    // Issuing card is always USD — decouple from quote currency (e.g. EUR from Sculpteo)
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
      currency: 'usd',
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
      },
    })
    cardId = card.id
    spendPath = 'issuing'
    console.warn(`[checkout-gate] Stripe Issuing card created (demo only — not executed): ${cardId}`)
  } catch (err) {
    console.warn('[checkout-gate] Stripe Issuing failed, falling back to sqlite record:', err.message)
  }
}

emitEvent(db, orderId, 'checkout_gate', 'checkout_approved',
  `Vendor checkout gate passed. Spend path: ${spendPath}.`,
  { spend_path: spendPath, card_id: cardId, executed: false, vendor_cost: vendorCost })

// Set final state so the order doesn't sit in approving_checkout forever
db.prepare("UPDATE orders SET state = 'checkout_approved', updated_at = ? WHERE id = ?")
  .run(Date.now(), orderId)

console.warn(`[checkout-gate] PASSED order=${orderId} spendPath=${spendPath} cardId=${cardId}`)

console.log(JSON.stringify({
  status: 'ok',
  spend_path: spendPath,
  card_id: cardId,
  executed: false,
  vendor_cost_cents: vendorCost,
  spend_cap_cents: SPEND_CAP_CENTS,
}))
process.exit(0)
