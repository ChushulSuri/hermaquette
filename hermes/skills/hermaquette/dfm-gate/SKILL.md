# Skill: dfm-gate

**Stage**: `dfm`
**Service**: hermes-worker
**Handler**: `services/hermes-worker/skills/dfm-gate.js`
**Calls**: `cad-dfm` Python service — `POST /dfm`
**NVIDIA beat**: Nemotron used for `dfm_explanation` step

## Description

Design-for-Manufacturing gate. Validates the STL against Sculpteo PA12 tolerances and
routes the outcome through three branches:

| DFM result | Action |
|------------|--------|
| `PASS`     | Enqueue `quote` |
| `FIXABLE`  | Apply bounded auto-fix → rebuild geometry → re-run DFM → enqueue `quote` on second PASS |
| `BLOCKED`  | Mark order blocked, stop pipeline |

NVIDIA Nemotron (llama-3.1-nemotron-70b) explains the result to the customer in plain English.
On FIXABLE, the lesson is appended to `hermes/MEMORY.md` (KTD11 learning loop).

## Trigger

A `jobs` row with `stage='dfm'` and `status='queued'`, created by build-geometry.

## Input (job.payload)

```json
{
  "stl_path": "/artifacts/<order_id>/relief.stl",
  "image_path": "/artifacts/<order_id>/concept_1.png",
  "params": {"text_depth_mm": 0.3, "…": "…"}
}
```

## Output (job.result)

```json
{
  "status": "PASS | PASS_AFTER_FIX | BLOCKED | NEEDS_REVIEW",
  "explanation": "plain English from Nemotron",
  "fix": "optional: description of fix applied",
  "next_stage": "quote"
}
```

## LLM steps

| step key          | provider  | model                                    | purpose                    |
|-------------------|-----------|------------------------------------------|----------------------------|
| `dfm_explanation` | **nemotron** | nvidia/llama-3.1-nemotron-70b-instruct | Explain DFM result to user |

Falls back to OpenAI if Nemotron is unavailable.

## Events emitted

| event          | when                              |
|----------------|-----------------------------------|
| `progress`     | start of DFM check                |
| `explanation`  | after Nemotron explanation        |
| `fix_applied`  | after FIXABLE auto-fix (if any)   |

## Memory / learning hooks

On `FIXABLE` outcome, appends a structured lesson to `hermes/MEMORY.md`:
```
## DFM Lesson — <ISO timestamp>
**Failure class**: thin_feature
**Details**: …
**Fix applied**: …
**Pre-emption rule**: Pre-thicken text features to ≥0.6mm on PA12 before DFM check
```
