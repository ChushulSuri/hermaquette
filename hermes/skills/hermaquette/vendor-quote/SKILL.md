---
name: vendor-quote
description: Use after DFM PASS to upload the STL to Sculpteo, enforce the fail-closed printability verdict (absent or non-printable verdict blocks checkout), compute vendor cost + 10% ledger, and advance to checkout.
version: 1.0.0
author: Hermaquette
license: MIT
metadata:
  hermes:
    tags: [hermaquette, vendor, sculpteo, quote, ledger]
---

# Skill: vendor-quote

**Stage**: `quote`
**Service**: hermes-agent
**Script**: `node /hermes/skills/hermaquette/vendor-quote/scripts/run.js <orderId>`
**Calls**: `packages/vendor/adapter.js` (dynamic import, graceful fallback)

## Description

Requests a manufacturing quote from Sculpteo via the VendorQuoteAdapter.
Computes the Hermaquette service fee (10% of vendor cost) and writes a `ledger` row.
Updates order state to `'quote'` — the web UI then presents the price for customer confirmation
before Stripe checkout is initiated.

## Trigger

Called by the orchestrator agent after DFM PASS. The agent runs:
```
node /hermes/skills/hermaquette/vendor-quote/scripts/run.js <orderId>
```

## Input (argv)

orderId (string) — reads spec from SQLite by orderId.

## Output (stdout JSON)

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
4. **Fail-closed printability gate (B5):** for a live (`quote_source` ∈ `live_api`/`browser`) quote, read the printability verdict. If the verdict is **absent** → throw (`printability_unverified`, "cannot auto-proceed to checkout"). If the verdict is **non-printable** → throw (`printability_failed`). Only an explicit `printable`/`ok` verdict proceeds. (Manual/cached quotes skip this and are gated separately at checkout by `DEMO_ALLOW_PENDING_QUOTE`.)
5. Compute fees (vendor cost + 10%)
6. INSERT/UPDATE `ledger` row keyed on `order_id` (idempotent — no plain INSERT against the UNIQUE index)
7. Update `spec.quote_status`, `orders.state → 'quote'`

## Adapter interface

```typescript
quote({ stl_path: string, material: string, qty: number })
  → Promise<{
      vendor_cost_cents: number, lead_time_days: number, currency: string,
      quote_source: 'live_api' | 'browser' | 'manual' | 'cached',
      printability?: 'printable' | 'ok' | string,  // live/browser verdict; the handler reads `printability ?? status`
      status?: string
    }>
```
For a live/browser quote the handler reads `printability ?? status` and **fail-closes** (throws) if the verdict is absent or non-printable.

## Invocation

```
node /hermes/skills/hermaquette/vendor-quote/scripts/run.js <orderId>
```

Input: orderId (string)
Output (stdout JSON): `{ status, ledger_id, vendor_cost_cents, service_fee_cents, revenue_cents, lead_time_days, quote_source }`
Exit: 0 on success, 1 on failure (printability failed, dfm_status not PASS, no ledger written)

## Memory / learning hooks

None on this stage.
