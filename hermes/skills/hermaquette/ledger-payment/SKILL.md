# Skill: ledger-payment

**Stage**: `payment`
**Service**: hermes-worker
**Handler**: `services/hermes-worker/skills/ledger-payment.js`

## Description

Records a confirmed Stripe payment against the ledger and advances the order to `'paid'`.
Enqueues the `checkout_gate` stage.

This skill is triggered by the web API's Stripe webhook handler after receiving a
`checkout.session.completed` event with `payment_status: 'paid'`. The webhook handler
creates the `jobs` row with `session_id` and `payment_status` in the payload.

## Trigger

A `jobs` row with `stage='payment'` and `status='queued'`, created by the Stripe webhook handler.

## Input (job.payload)

```json
{
  "session_id": "cs_test_…",
  "payment_status": "paid"
}
```

Both fields are required. A non-`'paid'` status throws and marks the job error.

## Output (job.result)

```json
{
  "status": "paid",
  "session_id": "cs_test_…",
  "next_stage": "checkout_gate"
}
```

## Steps

1. Validate `session_id` and `payment_status === 'paid'`
2. Verify `ledger` row exists for the order
3. UPDATE `ledger`: set `stripe_session_id`, `stripe_payment_status = 'paid'`
4. UPDATE `orders.state → 'paid'`
5. Emit `payment/confirmed` event
6. INSERT `jobs` row for `checkout_gate` with empty payload

## Events emitted

| event       | when                            |
|-------------|---------------------------------|
| `confirmed` | payment recorded, gate enqueued |

## Memory / learning hooks

None. Payment recording is deterministic.
