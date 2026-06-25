# Skill: build-geometry

**Stage**: `geometry`
**Service**: hermes-worker
**Handler**: `services/hermes-worker/skills/build-geometry.js`
**Calls**: `cad-dfm` Python service — `POST /geometry`

## Description

Drives the Python CAD pipeline to convert an approved concept image into a manufacturable STL:
1. Depth-anything-v2 → grayscale depth map
2. Heightmap → 3D relief mesh (OpenSCAD/CadQuery)
3. Parametric plaque frame
4. Boolean union → solid body
5. Export STL + GLB

On success, updates `spec` with paths and enqueues `dfm`.

## Trigger

A `jobs` row with `stage='geometry'` and `status='queued'`.
Created by the web API at `POST /orders/:id/select-image` after user picks a concept.

## Input (job.payload)

```json
{
  "approved_image_path": "/artifacts/<order_id>/concept_1.png",
  "params": {}
}
```

`approved_image_path` is required. Missing it throws immediately.

## Output (job.result)

```json
{
  "stl_path": "/artifacts/<order_id>/relief.stl",
  "glb_path": "/artifacts/<order_id>/relief.glb",
  "dimensions_mm": {"x": 100, "y": 80, "z": 6.5},
  "params": {"text_depth_mm": 0.3, "…": "…"},
  "state": "preview",
  "next_stage": "dfm"
}
```

## Steps

1. Read order + spec rows
2. Validate `approved_image_path` in payload
3. Determine `HAPPY_PATH` (env): sets `text_depth_mm=0.6` (PASS) vs `0.3` (triggers DFM demo)
4. POST to `CAD_DFM_URL/geometry` with 10-minute timeout
5. Update `spec.stl_path`, `spec.glb_path`, `spec.dimensions_mm`, `spec.dfm_status='NEEDS_REVIEW'`
6. Update `orders.state → 'preview'`
7. Enqueue `dfm` job with stl_path + params in payload

## Environment variables

| var                  | default               | purpose                       |
|----------------------|-----------------------|-------------------------------|
| `CAD_DFM_URL`        | `http://cad-dfm:8000` | cad-dfm service address       |
| `HAPPY_PATH`         | `off`                 | `on` pre-thickens text → PASS |
| `GEOMETRY_TIMEOUT_MS`| `600000`              | max time for geometry build   |

## Memory / learning hooks

Prior DFM lessons from `hermes/MEMORY.md` are applied here via `HAPPY_PATH` and parameter
pre-sets. Future: read lessons and apply dynamic param overrides before calling cad-dfm.
