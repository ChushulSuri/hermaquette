---
name: concept-images
description: Use to generate concept images for a full-3D figure (chunky designer-toy / chibi style, front-facing, single clean subject) that feed the image-to-3D step. Not a relief/depth-map step.
version: 1.0.0
author: Hermaquette
license: MIT
required_environment_variables:
  - FAL_KEY
  - NANOBANANA_API_KEY
metadata:
  hermes:
    tags: [hermaquette, concept, image-generation, full-3d]
---

# Skill: concept-images

**Stage**: `concept`
**Service**: hermes-agent
**Script**: `node /hermes/skills/hermaquette/concept-images/scripts/run.js <orderId>`

## Description

Generates 3-4 concept images of a **full-3D figure** (chunky designer-toy / chibi style) using a tiered image-generation stack:
1. **Nano Banana Pro** (primary, `NANOBANANA_API_KEY`)
2. **OpenAI DALL-E 3** (fallback, `OPENAI_API_KEY`)
3. Placeholder SVG (never blocks pipeline)

Images are art-directed as a **front-facing, single clean subject on a plain white background, suitable for fal.ai image-to-3D (Hunyuan3D) reconstruction** — bold shapes, clear silhouette, vibrant color. This is **not** a relief/coin/depth-map step (that was V1).
Emits `images_ready` event; UI presents images for user selection.
Does NOT auto-enqueue the next stage — web API does that when user picks an image.

**IMPORTANT: After presenting images, the orchestrator must STOP.** Do not proceed to geometry, vendor-quote, or any downstream step. The web UI handles concept selection and dispatches a separate geometry run after the customer picks an image.

## Trigger

Called by the orchestrator agent. The agent runs:
```
node /hermes/skills/hermaquette/concept-images/scripts/run.js <orderId>
```

## Input (argv)

orderId (string) — description is read from SQLite by the script (never passed as argv to prevent shell injection)

## Output (stdout JSON)

```json
{
  "images": [
    {"id": "…", "url": "https://…", "source": "nanobanana|dalle3|placeholder", "variation": 1}
  ],
  "count": 4,
  "status": "ok"
}
```

## Steps

1. Read order from `orders` (description from SQLite)
2. Build art-direction prompt (chunky full-3D figure, front-facing single subject, plain white background, vibrant color, suitable for image-to-3D)
3. Try Nano Banana Pro × 4 variations
4. If < 3 images: try DALL-E 3 × 1
5. If still 0: use placeholder SVGs × 3
6. Pad to minimum 3 images
7. Update `orders.state → 'concept'`
8. INSERT `events` row `event='images_ready'` with images array in `data`

## Events emitted

| event          | when                        |
|----------------|-----------------------------|
| `progress`     | start of generation         |
| `images_ready` | images array ready for UI   |

## Invocation

```
node /hermes/skills/hermaquette/concept-images/scripts/run.js <orderId>
```

Input: orderId (string — description is read from SQLite)
Output (stdout JSON): `{ status, images, count }`
Exit: 0 on success, 1 on fatal error (order not found, missing orderId)

## Memory / learning hooks

None. Image provider selection is purely env-driven.
