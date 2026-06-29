---
name: dfm-repair
description: Repair AI mesh geometry for SLS printability.
version: "1.0.0"
author: Hermaquette
license: MIT
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
  "repaired_stl_path": "/tmp/mesh_repaired.stl",
  "geometry_hash": "sha256hex"
}
```

## Steps

1. Download mesh from `stl_url` to a temp file
2. POST to CAD-DFM service `POST /dfm/ai-mesh` with `{ "stl_path": "/tmp/..." }`
3. If status is PASS or FIXABLE → emit `dfm/repair_applied` event, return result
4. If status is BLOCKED → emit `dfm/repair_blocked` event, return with blocked reason
5. Sculptor agent decides: PASS → proceed to texture, BLOCKED after attempt 2 → report UNREPAIRABLE

## Bounded decision

The Sculptor agent makes ONLY accept/reject decisions. It does NOT perform free-form
geometry reasoning or suggest mesh edits. The repair macro is deterministic.

## Events emitted

| event | stage | description |
|-------|-------|-------------|
| `repair_started` | dfm | DFM repair macro initiated |
| `repair_applied` | dfm | Repairs applied, mesh is printable |
| `repair_blocked` | dfm | Mesh cannot be repaired |

## Invocation

```
node /hermes/skills/hermaquette/dfm-repair/scripts/repair.js <orderId> [attempt] [parentRunId]
```

Input: orderId (string), attempt (int, default 1), parentRunId (optional — linked via COALESCE(run2_run_id, run_id) from SQLite)
Output (stdout JSON): `{ status, reason, applied_repairs, mesh_checks, repaired_stl_path, geometry_hash, attempt, dfm_explanation }`
Exit: 0 on PASS or FIXABLE, 1 on BLOCKED or fatal error

## Error handling

- CAD-DFM service unreachable → emit `dfm_blocked`, upsert spec `dfm_status=BLOCKED`, exit 1
- STL download fails → emit `dfm_blocked`, upsert spec `dfm_status=BLOCKED`, exit 1
