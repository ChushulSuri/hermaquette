---
name: image-to-3d
description: Generate printable 3D model from concept image.
version: "1.0.0"
author: Hermaquette
license: MIT
platforms:
  - hermes
metadata:
  tags:
    - 3d
    - fabrication
    - fal-ai
---

# image-to-3d

## Stage
sculptor

## Service
image3d

## Handler
generate

## Trigger
Sculptor agent receives approved concept image URL.

## Input
```json
{
  "image_url": "https://...",
  "order_id": "ord_abc123",
  "dry_run": false
}
```

## Output
```json
{
  "glb_url": "https://...",
  "stl_url": "https://...",
  "geometry_hash": "sha256hex",
  "model_used": "hunyuan3d-2",
  "cost_usd": 0.375,
  "provider": "hunyuan3d"
}
```

## Steps

1. Check budget via `packages/image3d/budget.js` `checkBudget()` — abort with `BudgetExhaustedError` if over cap
2. Call `generate3d(image_url, { orderId, dry_run })` from `packages/image3d/adapter.js`
3. Emit `sculptor/geometry_generated` event with `geometry_hash`
4. Return output object to Sculptor agent

## Events emitted

| event | stage | description |
|-------|-------|-------------|
| `geometry_started` | sculptor | fal.ai call initiated |
| `geometry_generated` | sculptor | Mesh URL + geometry_hash available |
| `geometry_failed` | sculptor | fal.ai call failed (provider error or budget exhausted) |

## Error handling

- `BudgetExhaustedError` → emit `geometry_failed`, return error to agent
- fal.ai 4xx → retry once after 5s, then fall back to Meshy
- fal.ai 5xx → immediate fallback to Meshy

## Invocation

```
node /hermes/skills/hermaquette/image-to-3d/scripts/generate.js <orderId> <image_url> [parentRunId]
```

Input: orderId (string), image_url (string), parentRunId (optional — from HERMES_RUN_ID env or argv[4])
Output (stdout JSON): `{ status, glb_url, stl_url, geometry_hash, model_used, cost_usd, provider }`
Exit: 0 on success, 1 on budget-exhausted or fatal error

## Memory / learning

- Record `geometry_hash` as provenance of the as-generated mesh. Do NOT assert hash equality after `dfm-repair` — the repair macro intentionally alters geometry (decimate/rescale), so the hash will not match.
