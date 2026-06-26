---
name: vendor-checkout-gate
description: Use to gate vendor spend — spend-cap check + human approval, then demonstrate (never execute) a test-mode Stripe Issuing virtual card scoped to shipping merchants; the card is never charged.
version: 1.0.0
author: Hermaquette
license: MIT
metadata:
  hermes:
    tags: [hermaquette, stripe, issuing, governance, spend-cap]
---

# Skill: vendor-checkout-gate

**Stage**: `checkout_gate`
**Service**: hermes-worker
**Handler**: `services/hermes-worker/skills/vendor-checkout-gate.js`
**Exports**: `approveVendorCheckout(db, orderId)` — called by web API

## Description

Governance gate before any real vendor spend. Evaluates the vendor cost against the
configured spend cap, creates a `vendor_order` record, and either blocks or requests
human approval via the UI.

**Stripe Issuing integration** (optional): when `STRIPE_ISSUING_ENABLED=true`, the
`approveVendorCheckout()` function issues a test-mode virtual card scoped to shipping
merchants with a per-authorization cap. The card is NEVER automatically charged or submitted
to the vendor — that requires a separate explicit step.

## Trigger

A `jobs` row with `stage='checkout_gate'` and `status='queued'`, created by ledger-payment.

## Input (job.payload)

```json
{}
```
All data is read from the `ledger` row.

## Output (job.result)

```json
{
  "status": "blocked | pending_approval",
  "vendor_order_id": "nano-id",
  "reason": "over_spend_cap"
}
```

## Approval flow

```
checkout_gate job runs
  → status=pending_approval
  → order.state = 'checkout_pending_approval'
  → events: awaiting_approval

Human reviews in UI → calls POST /orders/:id/approve
  → web API calls approveVendorCheckout(db, orderId)
  → optionally issues Stripe Issuing virtual card
  → vendor_order.status = 'approved'
  → order.state = 'checkout_approved'
  → events: approved
```

## Environment variables

| var                      | default  | purpose                                    |
|--------------------------|----------|--------------------------------------------|
| `SPEND_CAP_CENTS`        | `5000`   | Hard cap; above this always blocks         |
| `STRIPE_ISSUING_ENABLED` | `false`  | Set `true` to issue virtual cards          |
| `STRIPE_SECRET_KEY`      | —        | Stripe test key for Issuing API            |

## Events emitted

| event               | when                             |
|---------------------|----------------------------------|
| `progress`          | start of gate evaluation         |
| `blocked`           | cost > spend cap                 |
| `awaiting_approval` | within cap, needs human sign-off |
| `approved`          | `approveVendorCheckout()` called |

## Invocation

```
node /hermes/skills/hermaquette/vendor-checkout-gate/scripts/run.js <orderId>
```

Input: orderId (string)
Output (stdout JSON): `{ status, spend_path, card_id, executed, vendor_cost_cents, spend_cap_cents }` on pass; `{ status: "blocked", reason, ... }` on gate failure
Exit: 0 on gate pass, 1 on any gate failure (no Issuing card created on exit 1)

Fail-closed gate — ALL three conditions must be true to proceed:
1. `payment_confirmed_at IS NOT NULL`
2. `checkout_approved = 1`
3. `vendor_cost_cents <= SPEND_CAP_CENTS`

## Memory / learning hooks

None. Gate is policy-driven, not learned.
