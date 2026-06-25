# Skill: vendor-quote

**Stage**: `quote`
**Service**: hermes-worker
**Handler**: `services/hermes-worker/skills/vendor-quote.js`
**Calls**: `packages/vendor/adapter.js` (dynamic import, graceful fallback)

## Description

Requests a manufacturing quote from Sculpteo via the VendorQuoteAdapter.
Computes the Hermaquette service fee (10% of vendor cost) and writes a `ledger` row.
Updates order state to `'quote'` — the web UI then presents the price for customer confirmation
before Stripe checkout is initiated.

## Trigger

A `jobs` row with `stage='quote'` and `status='queued'`, created by dfm-gate on PASS.

## Input (job.payload)

```json
{
  "stl_path": "/artifacts/<order_id>/relief.stl"
}
```

Falls back to `spec.stl_path` if not in payload.

## Output (job.result)

```json
{
  "ledger_id": "nano-id",
  "vendor_cost_cents": 3200,
  "service_fee_cents": 320,
  "revenue_cents": 3520,
  "gross_margin_pre_fees_cents": 320,
  "lead_time_days": 7,
  "quote_source": "live_api | browser | manual",
  "state": "quote"
}
```

## Financial model

```
revenue     = vendor_cost + service_fee
service_fee = round(vendor_cost × 0.10)
gross_margin (pre Stripe fees) = service_fee
```

## Steps

1. Validate spec exists and `dfm_status === 'PASS'`
2. Emit `quote/progress` event
3. Dynamic import `packages/vendor/adapter.js`; if unavailable use manual estimate ($32.00, 7 days)
4. Compute fees
5. INSERT `ledger` row
6. Update `spec.quote_status`, `orders.state → 'quote'`

## Adapter interface

```typescript
quote({ stl_path: string, material: string, qty: number })
  → Promise<{ vendor_cost_cents: number, lead_time_days: number, currency: string, quote_source: string }>
```

## Memory / learning hooks

None on this stage.
