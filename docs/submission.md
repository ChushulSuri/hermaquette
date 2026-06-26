# Hermaquette V2 — Three Hermes Agents Ship a 3D Figure

> Deadline: EOD 2026-06-30 · Judges: Nous, NVIDIA, Stripe

## One-liner

Customer describes an object → three Hermes agents (Hermaquette → Sculptor → Follow-up)
design it, make it printable, price it, and manage fulfillment — while you watch a
colored 3D model rotate on screen.

---

## What it does

Hermaquette takes a text description and turns it into a full-3D colored model, a validated
printable STL, a Sculpteo quote, and a Stripe test payment — orchestrated entirely by three
Hermes agents delegating work to each other and to Hermes skills. The customer watches agent
progress in real time, approves the colored 3D model, and completes a test payment; a governed
Stripe Issuing card gate demonstrates how Hermaquette would pay the vendor without a human
in the loop. The on-screen model is PBR-textured and rotatable; the print artifact is single
material color (PA12 SLS) — honest about both.

---

## How Hermes does the work (Nous Research)

This is the key judge differentiator: **Hermes does the core work, not a web app that
occasionally calls an LLM.** Three Hermes agent zones (Hermaquette → Sculptor → Follow-up)
are defined in `hermes/agents/*/AGENT.md`; manufacturing operations are Hermes skills
(SKILL.md + scripts). **Two runtime modes**: when `HERMES_GATEWAY_URL` is configured, the
gateway runs real agents with native `delegate_task`; in direct mode (default), the same
skills execute as a JS pipeline in `hermes-worker` with identical Hermes-attributed events.

- **Hermaquette (orchestrator agent)**: receives the order, calls the `concept-images` skill
  (Nano Banana Pro), reviews concept images against 3D-friendliness criteria and redoes up to
  2×, captures customer approval, then delegates the build to Sculptor via `delegate_task`.
  After the quote is ready, handles Stripe Checkout and the governed Issuing gate. Delegates
  post-order to Follow-up.

- **Sculptor (image-to-3D agent)**: receives the approved concept image and spec. Calls the
  `image-to-3d` skill (fal.ai Hunyuan3D v2) to generate untextured geometry, then runs the
  `dfm-repair` skill — a bounded loop that verifies (watertight, wall thickness, size,
  components) and applies a deterministic repair macro (fill holes, make watertight, remove
  debris, rescale, decimate). The Sculptor makes one bounded decision after each repair pass:
  **accept** (advance to texturing) or **reject** (ask orchestrator for a new concept image).
  On accept, textures the same frozen geometry (same geometry_hash end-to-end) and returns a
  colored PBR GLB + printable STL. Sculpteo's printability verdict is the final gate.

- **Follow-up agent**: owns post-order. Polls tracking, runs GPT-vision QA on the delivery
  photo vs. the original spec, and drafts a reprint or refund request — but never sends without
  explicit human approval (`pending_approval` gate).

All three agents are defined as `hermes/agents/*/AGENT.md` with scoped toolsets (Sculptor has
no access to commerce tools; Follow-up has no access to geometry tools). Hermes-attributed
progress is streamed to the UI at each delegation step.

---

## NVIDIA integration

- **Nemotron (`llama-3.1-nemotron-70b-instruct`)** explains DFM results in plain English when
  the Sculptor accepts or rejects a mesh — "text walls too thin for PA12 SLS at this scale;
  recommend a simpler pose" rather than a raw mesh error code. This is the on-camera NVIDIA beat.
- A second `hermes-agent` gateway runs on port 8643 configured with the NVIDIA API key; the
  Sculptor routes `dfm_explanation` and `repair_narration` steps there. Hermes makes the NVIDIA
  API call; the worker holds no NVIDIA credentials.
- fal.ai Hunyuan3D v2 is the image-to-3D engine (image → colored 3D figure); not GPU-hosted
  in V2 (self-hosting on NVIDIA GPU is a V3 stretch).
- **$10 hard budget guard**: `packages/image3d/budget.js` runs a precheck before every fal call
  and refuses if over cap; a separate `FAL_DEV_BUDGET_USD` reserves demo allowance.

---

## Stripe integration

- **Stripe Checkout**: test-mode hosted payment for the Sculpteo manufacturing quote + 10%
  Hermaquette service margin. Session created via the Stripe SDK (`stripe.checkout.sessions.create`),
  confirmed server-side by `sessions.retrieve` (no webhooks, idempotent).
- **Stripe Issuing**: governed virtual card gate for vendor payment. On human approval, Hermes
  issues a test-mode virtual card with `spending_limits` set to the vendor cost and a
  merchant-category scope — the agentic-commerce governance primitive. The card is demonstrated
  but never executed (no real Sculpteo purchase) in the demo.
- **Full commerce loop**: fal.ai generation cost is included in COGS; vendor cost + 10%
  Hermaquette margin = customer price shown before Checkout.

---

## Demo notes

The 90-second demo shows the complete flow with all three agent delegations visible:

1. Customer describes the Nous Research Girl figure (chunky chibi / designer-toy style)
2. Hermaquette calls concept-images skill → customer selects a concept
3. Hermaquette delegates to Sculptor — **delegation event visible on camera**
4. Sculptor runs image-to-3D, DFM-repair loop, Nemotron explanation — **DFM beat on camera**
5. Sculptor returns colored GLB — **interactive 3D model rotates on screen**
6. Sculpteo quote + 10% fee → customer approves
7. Stripe Checkout TEST MODE → payment confirmed
8. Issuing gate demonstrated (card issued, not charged)
9. Hermaquette delegates to Follow-up — **third delegation visible**
10. (Optional) DFM lesson written to MEMORY.md; second object: first-run PASS (learning payoff)

---

## Honest framing

| Claim | Reality |
|-------|---------|
| Stripe payments | TEST MODE — use card `4242 4242 4242 4242`; no real charges |
| Interactive viewer | Full-color PBR textured GLB — orbit/zoom/rotate |
| Printed artifact | Single material color (PA12 SLS) — full-color printing is V3 (deferred) |
| Gross margin | Pre-fees only; fal.ai generation cost included in COGS |
| Issuing gate | Demonstrated but not executed — no real vendor payment in demo |
| Vendor quote | Live Sculpteo API (or recorded fallback, labelled as such) |
| Rights | One-off tribute · Not for resale · No affiliation with Nous/Hermes claimed |

---

## Required Submission Steps

- [ ] 1. Tweet the demo video (1–3 min) tagging @NousResearch
- [ ] 2. Post tweet link in Discord #submissions
- [ ] 3. Submit the Typeform

---

## Tweet Blurb (<=280 chars)

```
Hermaquette V2: describe an object → 3 Hermes agents design it, build a colored 3D model,
repair it for printing, quote it, and take a governed Stripe payment.
Hermaquette orchestrates. Sculptor generates. Follow-up QAs. @NousResearch #HermesHackathon
```

**Variant (with metric)**:
```
Hermaquette V2: 3 Hermes agents, 1 sentence → full-color 3D figure.
Orchestrator delegates to Sculptor (fal.ai + DFM-repair) → colored GLB in the browser.
Stripe Checkout + Issuing gate. Nemotron explains the DFM. @NousResearch #HermesHackathon
```

---

## Video Script Notes (1–3 min)

**Open (10s)**: "Most agents move data. Hermaquette ships atoms — and now three Hermes agents
do the work. Watch Hermes turn a text description into a full-colored 3D figure, validate it
for printing, quote it, and take a Stripe payment."

**Hero path (60s)**:
- Describe the Nous Research Girl figure
- Hermaquette calls concept-images skill → concepts appear → customer selects one
- "Hermaquette delegating to Sculptor…" — delegation event visible
- Sculptor calls image-to-3D (Hunyuan3D v2) — geometry arrives
- **DFM-repair loop** — Nemotron explains the result → **DFM PASS** (this is the demo beat)
- Sculptor textures → colored 3D model appears → customer rotates/zooms it
- Sculpteo quote + 10% fee → customer price
- Stripe Checkout TEST MODE → payment confirmed
- Issuing gate → card issued (never charged)
- "Hermaquette delegating to Follow-up…" — third delegation visible

**Close (10s)**:
- Show the architecture diagram (three agents, three delegations)
- "Three Hermes agents. NVIDIA Nemotron. Stripe Checkout + Issuing. Other agents move bits.
  Hermaquette ships atoms."

---

## Typeform Answers

**Project name**: Hermaquette

**One-line description**: Three Hermes agents (Hermaquette → Sculptor → Follow-up) turn a
sentence into a full-colored 3D figure, validate it for printing, quote it from Sculpteo,
and take a governed Stripe payment — all via native `delegate_task`.

**How does your project use Hermes?**
Three Hermes agents wired with native `delegate_task`. Hermaquette (orchestrator) calls the
concept-images skill, reviews/redoes concepts, then delegates to the Sculptor agent to build
the 3D model. Sculptor calls image-to-3d (fal.ai Hunyuan3D v2) and dfm-repair skills —
verify + repair mesh loop — and makes bounded accept/reject decisions. Orchestrator then
handles commerce (Sculpteo quote, Stripe Checkout, Issuing gate) and delegates post-order to
the Follow-up agent (tracking + GPT-vision QA). All manufacturing ops are Hermes skills
(SKILL.md + scripts) under `hermes/skills/hermaquette/`. Two gateway processes: port 8642
(GPT-5.5/ChatGPT OAuth primary), port 8643 (Nemotron for DFM explanation). llm.js holds zero
provider credentials — talks only to the gateways. Hermes-attributed progress events stream
to the UI naming which agent did each step.

**How does your project use NVIDIA?**
Nemotron (`nvidia/llama-3.1-nemotron-70b-instruct` via `integrate.api.nvidia.com/v1`) is the
designated model for on-camera DFM explanation and repair narration. When the Sculptor's
DFM-repair loop accepts or rejects a mesh, Nemotron translates the mesh report into plain
English ("text walls too thin for PA12 at this scale") — the unmistakable NVIDIA beat. A
dedicated Hermes gateway on port 8643 holds the NVIDIA key; the Sculptor routes dfm_explanation
and repair_narration steps there. Hermes makes the NVIDIA API call; the worker holds no
NVIDIA credentials. Geometry decisions are deterministic; Nemotron handles language only.

**How does your project use Stripe?**
Two Stripe primitives: (1) Customer leg — hosted Checkout in test mode, session created via
the Stripe SDK (restricted rk_test_* key), confirmed server-side by sessions.retrieve (no
webhooks). (2) Vendor leg — on human approval, Hermes issues a test-mode Stripe Issuing
virtual card with spending_limits = vendor cost and merchant-category scope (the agentic-
commerce governance primitive). The card is demonstrated but never charged. The Hermaquette
orchestrator adds a 10% service margin over vendor cost (including fal.ai generation COGS)
before creating the Checkout session. SQLite approval-record fallback if Issuing test access
is unavailable.

**Demo video link**: [to be added after recording]

**GitHub repo**: [to be added]

**Any other notes?**
Honesty disclosures: all Stripe charges are TEST MODE; gross margin is pre-fees; fal.ai
generation cost is included in COGS; vendor quotes may be from a recorded fallback labelled
as such; one-off personal tribute / not for resale / no affiliation with Nous claimed. The
on-screen model is full-color PBR; the printed artifact is single material color (PA12 SLS) —
full-color printing is a deferred V3 feature, disclosed in the UI. Stripe Issuing gate is
demonstrated but not executed in the demo.

---

## Submission Checklist

- [ ] Video recorded and uploaded (1–3 min)
- [ ] Tweet posted tagging @NousResearch with video
- [ ] Tweet link copied
- [ ] Discord #submissions post with tweet link
- [ ] Typeform filled (all fields above)
- [ ] GitHub repo public with this README
- [ ] .env.example has all required vars (FAL_KEY, FAL_BUDGET_USD, NANOBANANA_API_KEY, etc.)
- [ ] docker compose up works cleanly
- [ ] dry-run passes (hero + generic)
- [ ] cold-run truth-test passes (HAPPY_PATH=off + cleared cache)
- [ ] fal.ai spend under $10 (check budget log after dry-run)
- [ ] three-agent delegation visible in event stream
- [ ] single-color-print disclosure visible in colored viewer
