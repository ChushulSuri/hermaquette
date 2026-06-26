---
name: dfm-repair
description: Repair AI mesh geometry for SLS printability.
version: "1.0.0"
author: Hermaquette
license: MIT
platforms:
  - hermes
metadata:
  tags:
    - dfm
    - fabrication
    - manifold3d
---

# dfm-repair

## Stage
sculptor

## Service
cad-dfm

## Handler
repair

## Trigger
Sculptor agent has a mesh URL from image-to-3d skill.

## Input
```json
{
  "stl_url": "https://...",
  "geometry_hash": "sha256hex",
  "attempt": 1,
  "order_id": "ord_abc123"
}
```

## Output
```json
{
  "status": "PASS",
  "reason": "Repairs applied: rescale_to_80.0mm",
  "applied_repairs": ["rescale_to_80.0mm (factor 2.5)"],
  "mesh_checks": {
    "is_watertight": true,
    "volume_mm3": 153600.0,
    "dimensions_mm": [80.0, 60.0, 45.0],
    "triangle_count": 45000,
    "component_count": 1
  },
  "repaired_stl_path": "/artifacts/<orderId>/dfm/attempt_1_repaired.stl",
  "geometry_hash": "sha256hex"
}
```

## Steps

1. Download mesh from `stl_url` into the **shared `/artifacts/<orderId>/dfm/` volume** (NOT `/tmp` — `/tmp` is not shared between the worker and cad-dfm containers; both mount `/artifacts`)
2. POST to CAD-DFM service `POST /dfm/ai-mesh` with `{ "stl_path": "/artifacts/<orderId>/dfm/attempt_N.stl" }`
3. If status is PASS → emit `dfm/repair_applied`, enqueue `quote`
4. If status is FIXABLE and attempts remain → emit `dfm/repair_retry`, re-enqueue `dfm-repair` (attempt+1) on the repaired mesh
5. If status is BLOCKED, or still FIXABLE after attempt 2 → emit `dfm/repair_blocked`, set `dfm_blocked`
6. Sculptor agent decides only: PASS → accept, BLOCKED/exhausted → report UNREPAIRABLE

## Bounded decision

The Sculptor agent makes ONLY accept/reject decisions. It does NOT perform free-form
geometry reasoning or suggest mesh edits. The repair macro is deterministic.

## Runtime note

In the current JS-queue runtime, on PASS this skill **auto-enqueues the `quote` stage** (with `stl_url: file://<repaired_stl_path>`). Under true Hermes `delegate_task`, the Sculptor would return to the orchestrator and the orchestrator would drive the quote — the auto-enqueue would be removed. It also fires the **NVIDIA Nemotron** DFM explanation (`step: dfm_explanation`) on each attempt (explanation only — never decides status).

## Events emitted

| event | stage | description |
|-------|-------|-------------|
| `repair_started` | dfm | DFM repair macro initiated |
| `repair_applied` | dfm | Mesh passes DFM — proceeding to quote |
| `repair_retry` | dfm | FIXABLE — re-running on the repaired mesh (next attempt) |
| `repair_blocked` | dfm | Mesh cannot be repaired (BLOCKED or exhausted) |

## Error handling

- CAD-DFM service unreachable → emit `repair_blocked` and **throw** (the job-processor marks the order `error`); on the final attempt the order is set `dfm_blocked`.
- STL download fails → emit `repair_blocked` and **throw** (same handling). These are infrastructure failures, not a clean `BLOCKED` DFM verdict — only the `/dfm/ai-mesh` response itself returns a structured `PASS`/`FIXABLE`/`BLOCKED`.
