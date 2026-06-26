---
name: tracking-qa
description: Roadmap/scaffold (not yet implemented) — order tracking + GPT-vision delivery QA comparing form/shape (not color, since prints are single-color) + a drafted reprint/refund that requires human approval and is never auto-sent.
version: 0.1.0
author: Hermaquette
license: MIT
metadata:
  hermes:
    tags: [hermaquette, tracking, qa, vision, roadmap]
---

# Skill: tracking-qa

**Stage**: `tracking_qa`
**Service**: hermes-worker
**Handler**: `services/hermes-worker/skills/tracking-qa.js` *(not yet implemented — roadmap)*
**Status**: Scaffold — implementation deferred (cut-first per the V2 cut ladder)

> When implemented, follow the schema in `hermes/agents/followup/AGENT.md` (canonical): inputs `tracking_status`, `delivery_photo_url`; QA output `{ qa_result: "pass"|"mismatch", confidence, issues, comparison_notes }`. **Compare form/shape, NOT color** (prints are single-color; the concept image is full-color). Drafts are `pending_approval` and never auto-sent.

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

## Input / Output (canonical — follow `hermes/agents/followup/AGENT.md`)

Tracking mode input: `{ orderId }` → returns `{ tracking_status }`. Vision-QA mode input: `{ delivery_photo_url, order spec (shape/dimensions/material), concept_image_url }` → returns:

```json
{
  "qa_result": "pass" | "mismatch",
  "confidence": 0.0,
  "issues": ["..."],
  "comparison_notes": "..."
}
```

Compare **form/shape, NOT color** (prints are single-color; the concept image is full-color). On `mismatch`, the Follow-up agent drafts a reprint/refund with status `pending_approval` and **never auto-sends** it.

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
