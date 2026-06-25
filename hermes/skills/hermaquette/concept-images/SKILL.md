# Skill: concept-images

**Stage**: `concept`
**Service**: hermes-worker
**Handler**: `services/hermes-worker/skills/concept-images.js`

## Description

Generates 3-4 concept images for the relief sculpture using a tiered image-generation stack:
1. **Nano Banana Pro** (primary, `NANOBANANA_API_KEY`)
2. **OpenAI DALL-E 3** (fallback, `OPENAI_API_KEY`)
3. Placeholder SVG (never blocks pipeline)

Images are art-directed for high-contrast front-facing relief suitable for depth-map extraction.
Emits `images_ready` event; UI presents images for user selection.
Does NOT auto-enqueue the next stage — web API does that when user picks an image.

## Trigger

A `jobs` row with `stage='concept'` and `status='queued'`, created by intake-research.

## Input (job.payload)

```json
{
  "description": "cleaned front-facing description from research",
  "material": "pa12"
}
```

## Output (job.result)

```json
{
  "images": [
    {"id": "…", "url": "https://…", "source": "nanobanana|dalle3|placeholder", "variation": 1}
  ],
  "count": 4,
  "state": "concept"
}
```

## Steps

1. Read order from `orders`
2. Build art-direction prompt (coin relief, high contrast, depth-map suitable)
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

## Memory / learning hooks

None. Image provider selection is purely env-driven.
