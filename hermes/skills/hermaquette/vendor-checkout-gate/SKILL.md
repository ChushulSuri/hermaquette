---
name: vendor-checkout-gate
description: Use to gate vendor spend — spend-cap check + human approval, then demonstrate (never execute) a test-mode Stripe Issuing virtual card scoped to shipping merchants; the card is never charged.
version: 1.0.0
author: Hermaquette
license: MIT
required_environment_variables:
  - STRIPE_SECRET_KEY
  - STRIPE_ISSUING_ENABLED
  - SPEND_CAP_CENTS
metadata:
  hermes:
    tags: [hermaquette, stripe, issuing, governance, spend-cap]
---

# Skill: vendor-checkout-gate

**Stage**: `checkout_gate`
**Service**: hermes-agent
**Script**: `node /hermes/skills/hermaquette/vendor-checkout-gate/scripts/run.js <orderId>`

## Description

Governance gate before any real vendor spend. Fail-closed: ALL three conditions must be true to proceed:
1. `payment_confirmed_at IS NOT NULL` (payment confirmed)
2. `checkout_approved = 1` (human approved — not checkout_pending_approval)
3. `vendor_cost_cents <= SPEND_CAP_CENTS` (within cap)

If any condition fails: writes `checkout_blocked` event + exits 1 (no Issuing card created).
If all pass: demonstrates (never executes) a test-mode Stripe Issuing virtual card.

**Stripe Issuing integration** (optional): when `STRIPE_ISSUING_ENABLED=true`, the
script issues a test-mode virtual card scoped to shipping merchants with a per-authorization cap.
The card is NEVER automatically charged or submitted to the vendor.

## Trigger

Called by the orchestrator agent during Run 2 (after human approval). The agent runs:
```
node /hermes/skills/hermaquette/vendor-checkout-gate/scripts/run.js <orderId>
```

## Input (argv)

orderId (string) — the order to evaluate.

## Output (stdout JSON)

```json
{
  "status": "ok",
  "spend_path": "issuing | sqlite",
  "card_id": "card_xxx | null",
  "executed": false,
  "vendor_cost_cents": 3200,
  "spend_cap_cents": 5000
}
```

## Approval flow

```
Run 1: vendor-quote writes ledger → money card presented → STOP
Customer pays via Stripe Checkout → payment_confirmed_at set
Human clicks Approve → checkout_approved = 1 (atomic flip)
Run 2 dispatched → agent runs vendor-checkout-gate
  → re-verifies payment_confirmed_at + checkout_approved + cap (fail-closed)
  → demonstrates test Issuing card (never executes)
  → delegates Follow-up agent
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
