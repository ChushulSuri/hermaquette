# Skill: intake-research

**Stage**: `research`
**Service**: hermes-worker
**Handler**: `services/hermes-worker/skills/intake-research.js`

## Description

Research stage for a new order. Given a customer's free-text description, Hermes:
1. Finds legitimate public reference URLs for the subject
2. Determines a rights framing (personal gift, no commercial claim)
3. Produces a clean front-facing description optimised for image generation
4. Recommends the best print material (pa12 / resin / tpu)

Writes the first `spec` row. Enqueues the `concept` stage.

## Trigger

A `jobs` row with `stage='research'` and `status='queued'` or `status='running'`.
Created by the web API at `POST /orders` after the order row is inserted.

## Input (job.payload)

```json
{}
```
All data is read directly from the `orders` row (`id`, `description`, `material`).

## Output (job.result)

```json
{
  "specId": "nano-id",
  "provenance": [{"url": "…", "title": "…", "notes": "…"}],
  "rights_framing": "one-off personal gift, not for resale, …",
  "front_facing_description": "…",
  "material_recommendation": "pa12",
  "next_stage": "concept"
}
```

## Steps

1. Read order from `orders` table
2. Emit `research/progress` event
3. Call GPT-4o with structured research prompt (step=`research`)
4. Parse JSON response; fall back to safe defaults on parse error
5. Insert `spec` row with `provenance` JSON, `dfm_status='NEEDS_REVIEW'`
6. Update `orders.state → 'research_done'`, `orders.material`
7. Insert `jobs` row for `concept` stage with `front_facing_description` in payload

## LLM step

| step key   | provider | model   |
|------------|----------|---------|
| `research` | openai   | gpt-4o  |

## Memory / learning hooks

None on this stage. Lessons from dfm-gate are applied upstream at geometry build time.
