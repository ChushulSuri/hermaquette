# Skill: tracking-qa

**Stage**: `tracking_qa`
**Service**: hermes-worker
**Handler**: `services/hermes-worker/skills/tracking-qa.js` *(not yet implemented)*
**Status**: Scaffold — implementation in U5

## Description

Post-delivery quality assurance. After the vendor ships the print:
1. Monitors Sculpteo tracking URL for delivery confirmation
2. When delivered: requests customer to upload a photo (or uses vendor-provided photo)
3. Passes photo to GPT-4V for defect detection and dimension verification
4. Produces a draft QA action (`approve | flag_for_review | request_reprint | refund`)
5. Requires human approval before executing the draft action

## Trigger

A `jobs` row with `stage='tracking_qa'` and `status='queued'`, created after vendor
submission confirms a tracking number.

## Input (job.payload)

```json
{
  "tracking_number": "…",
  "tracking_url": "https://sculpteo.com/track/…",
  "expected_dimensions_mm": {"x": 100, "y": 80, "z": 6.5}
}
```

## Output (job.result)

```json
{
  "delivery_confirmed": true,
  "vision_result": {
    "pass": true,
    "defects": [],
    "confidence": 0.97
  },
  "draft_action": "approve",
  "draft_status": "pending_approval"
}
```

## LLM steps

| step key       | provider | model   | purpose                              |
|----------------|----------|---------|--------------------------------------|
| `qa_vision`    | openai   | gpt-4o  | Vision defect detection              |
| `qa_narration` | nemotron | nemotron-70b | Explain QA result to customer   |

## Events emitted

| event                  | when                              |
|------------------------|-----------------------------------|
| `tracking_update`      | periodic delivery status checks   |
| `delivered`            | carrier confirms delivery         |
| `qa_result`            | vision analysis complete          |
| `awaiting_qa_approval` | draft action needs human sign-off |

## Invocation

```
node /hermes/skills/hermaquette/tracking-qa/scripts/run.js <orderId>
```

Input: orderId (string)
Output (stdout JSON): `{ status, tracking_status, qa_result, draft_action, notes }`
Exit: 0 on success, 1 on fatal error (order not found)

B5 guarantee: no send/transmit code exists in this script — never-auto-send is structurally enforced.

## Memory / learning hooks

On `request_reprint`: records defect class and dimensional variance in `hermes/MEMORY.md`
to improve geometry parameters for future orders of the same object type.
