# Hermaquette — Hackathon Submission Package

> Deadline: EOD 2026-06-30 · Judges: Nous, NVIDIA, Stripe

## Required Submission Steps

- [ ] 1. Tweet the demo video (1–3 min) tagging @NousResearch
- [ ] 2. Post tweet link in Discord #submissions
- [ ] 3. Submit the Typeform

---

## Tweet Blurb (<=280 chars)

```
Hermaquette: describe an object → Hermes researches, builds CAD, validates DFM, quotes Sculpteo,
takes Stripe payment, governs vendor checkout — fully agentic.
Other agents move bits. We ship atoms. @NousResearch #HermesHackathon
```

**Variant (with metric)**:
```
Hermaquette: describe an object → manufacturable 3D print.
Hermes runs the full pipeline: concepts → CAD → DFM fail/fix → real quote → Stripe payment → governed checkout.
Lesson #1 recorded. Generic object: first-run PASS. @NousResearch #HermesHackathon
```

---

## Video Script Notes (1–3 min)

**Open (10s)**: "Most agents move data. Hermaquette ships atoms. Watch Hermes turn a text description into a validated, quoted, 3D-printed object."

**Hero path (60s)**:
- Describe the Nous Girl Hermes relief plaque
- Hermes researches provenance (rights framing visible)
- Concept images appear — select one
- 3D geometry builds in real time — interactive GLB preview
- **DFM fails** (text too thin) — Nemotron explains it — auto-fix applied — **DFM PASS** (this is the demo beat)
- Lesson written to MEMORY.md (show the file)
- Sculpteo quote + 10% fee → customer price
- Stripe Checkout TEST MODE → payment confirmed
- Governed vendor gate → Issuing virtual card issued (never charged)

**Generic object (20s)**:
- "Second object. Same thin-text defect class."
- DFM runs → first-run PASS — "Lesson applied. Zero text failures."
- Show learning metric panel: "2 lessons, 1 failure avoided"

**Close (10s)**:
- Show the architecture (one diagram)
- "Hermes skills + NVIDIA Nemotron + Stripe Issuing. Other agents move bits. Hermaquette ships atoms."

---

## Typeform Answers

**Project name**: Hermaquette

**One-line description**: Hermes-operated micro-manufacturing pipeline — describe a non-electronic object, get a validated, quoted, 3D-printable part with governed vendor checkout.

**How does your project use Hermes?**
Hermaquette is built entirely around Hermes as the private agent worker. All 8 pipeline stages are Hermes custom skills (SKILL.md + scripts). Hermes owns the orchestration: research, concept image art-direction, geometry build coordination, DFM gate + explanation, vendor quoting, payment confirmation, and governed vendor checkout. The DFM learning loop (KTD11) writes lessons to MEMORY.md after each failure — later runs consult the memory to pre-empt known defects. GPT (ChatGPT OAuth) is the primary LLM; Nemotron handles designated steps.

**How does your project use NVIDIA?**
NVIDIA Nemotron (`nvidia/llama-3.1-nemotron-70b-instruct` via `integrate.api.nvidia.com/v1`) is the designated model for the on-camera DFM-error explanation step and repair narration — the unmistakable NVIDIA beat in the demo. Configured via Hermes's native `hermes model` provider routing. Geometry decisions remain deterministic (no LLM geometry); Nemotron handles language only.

**How does your project use Stripe?**
Two Stripe primitives: (1) Customer leg — hosted Checkout in test mode, session created via the Stripe Agent Toolkit (restricted rk_test_* key), confirmed server-side by sessions.retrieve. (2) Vendor leg — on human approval, Hermes issues a test-mode Stripe Issuing virtual card with spending_limits = spend cap and merchant-category scope (the actual agentic-commerce governance primitive). The card is never charged. SQLite approval record fallback if Issuing test access is unavailable.

**Demo video link**: [to be added after recording]

**GitHub repo**: [to be added]

**Any other notes?**
Honesty disclosures: all Stripe charges are TEST MODE; gross margin is pre-fees; vendor quotes may be from a recorded fallback labelled as such; one-off personal gift / not for resale / no affiliation with Nous claimed. The generic repeatability object demonstrates cross-object learning payoff honestly — it shares the same thin-text defect class as the hero, so the recorded lesson is genuinely applicable.

---

## Submission Checklist

- [ ] Video recorded and uploaded (1–3 min)
- [ ] Tweet posted tagging @NousResearch with video
- [ ] Tweet link copied
- [ ] Discord #submissions post with tweet link
- [ ] Typeform filled (all fields above)
- [ ] GitHub repo public with this README
- [ ] .env.example has all required vars
- [ ] docker compose up works cleanly
- [ ] dry-run passes (hero + generic)
- [ ] cold-run truth-test passes (HAPPY_PATH=off + cleared cache)
