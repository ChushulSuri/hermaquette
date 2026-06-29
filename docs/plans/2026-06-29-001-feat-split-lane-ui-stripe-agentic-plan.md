---
title: "feat: Split-lane UI + Stripe agentic transaction"
status: active
date: 2026-06-29
type: feat
depth: standard
---

# feat: Split-lane UI + Stripe agentic transaction

## Summary

Two coupled workstreams to lift the demo's presentation and Stripe-judge story before EOD 2026-06-30:

- **A — Split-lane UI.** Replace the single-column order page with a Lovable-style two-pane layout: a chat-styled activity pane on the left, a progressive canvas on the right (concepts → revision variants → movable colored 3D → money/pay/approval). Add an optional reference-image upload, a capped concept-revision loop, and a shared **access-code gate** so random visitors can't burn the fal.ai/Nano Banana/Stripe budget. Reword leftover V1 "relief" copy to the full-3D figure story.
- **B — Stripe agentic.** Make the agent transact through Stripe's **official agent tooling** (Stripe MCP server, with `@stripe/agent-toolkit`-in-skill as the documented fallback), for the customer payment link and the governed Issuing card — while preserving the existing spend-cap + human-approval gate (fail-closed).

This plan changes presentation and the payment **integration surface**. It does **not** redesign the pipeline/skill logic, change the 3-run lifecycle, or fix Coolify's build (deploy stays manual `docker compose`).

---

## Problem Frame

The app is live and the pipeline works, but two gaps hurt the submission:

1. **Presentation.** The order page is a vertical scroll that reveals sections top-to-bottom. There's no chat surface, no image upload, no way to iterate on a concept, and copy still says "relief" (a V1 artifact that contradicts the full-3D-figure story). Judges score "agents visibly doing work" — the current layout buries it.
2. **Budget exposure.** The public URL lets anyone start a run, each of which spends real fal.ai / Nano Banana / Stripe budget.
3. **Stripe story.** Stripe (a judge) sponsors an **Agent Toolkit / MCP** for agentic commerce. Today Stripe is called from a deterministic gate script via the raw `stripe` SDK — correct, but it doesn't demonstrate the agent *choosing* to transact through Stripe's agent infrastructure.

---

## Key Technical Decisions

- **KTD1 — Left pane is a chat-*styled* activity feed, not a two-way LLM chat.** It renders the event stream (Hermes messages + user actions as bubbles) and hosts contextual structured inputs (describe, pick, revise, pay, approve). Rationale: real conversational intent-parsing is a multi-day build; the chat-styled feed reads identically on camera and reuses the existing SSE event stream. Real two-way chat is deferred.
- **KTD2 — Revision loop re-generates real variants, capped at 3 revisions/order.** A revision re-runs concept generation with a revised prompt (one extra Nano Banana call). Rationale: it's the visible "wow" and small to build; the cap bounds spend.
- **KTD3 — Access code is a single fixed shared secret in env (`ACCESS_CODE`), validated server-side, stored in an httpOnly session cookie.** Whoever holds the code can use it. Rationale: matches the user's "share to Discord/team" model; no per-user accounts.
- **KTD4 — Stripe agentic via MCP server first, `@stripe/agent-toolkit`-in-skill as fallback (decided by a short spike, U8).** Either way the agent's Stripe calls stay **behind the existing `vendor-checkout-gate` governance** (cap + `payment_confirmed_at` + `checkout_approved`). Rationale: MCP is the strongest "agent uses Stripe's agent infra" story; the toolkit-in-skill path is the de-risked fallback if MCP doesn't stand up in time. Governance must never be bypassed.
- **KTD5 — No pipeline/lifecycle redesign.** SQLite stays source of truth; the web app stays a thin `/v1/runs` client; the 3-run lifecycle and skill contracts are unchanged except where U6/U9 add a revision path and route Stripe through agent tooling.

---

## Scope Boundaries

**In scope:** two-pane UI shell + chat-styled left pane + progressive right canvas; reference-image upload; capped concept-revision loop; access-code gate; "relief"→figure copy; Stripe agent-tooling integration (MCP or toolkit) preserving the governance gate; AGENTS.md guidance so Hermaquette uses the Stripe tools at the gated step.

**Deferred to Follow-Up Work:** real two-way conversational chat with the orchestrator; per-user auth/accounts; multi-image upload; revision history UI beyond the variant strip; fixing Coolify's build wrapper.

**Out of scope / non-goals:** changing the 3-run lifecycle or skill DFM logic; changing the SQLite schema beyond what U5/U6 need; any change that bypasses the spend-cap/approval gate.

---

## Risky vs safe-to-cut (deadline triage)

- **Safe + high-impact (do first):** U1 access-code, U7 copy reword, U2–U4 split-lane shell + panes. These are pure web-layer, low-risk, and carry the demo.
- **Medium:** U5 image upload, U6 revision loop (touch a skill + storage).
- **Riskiest (timebox; have fallback):** U8/U9 Stripe MCP. **Cut path:** if the MCP spike (U8) doesn't stand up in ~2 hrs, ship `@stripe/agent-toolkit`-in-skill (still a real Stripe-agent-tooling story) or, worst case, keep today's raw-SDK gate and narrate it — the governance gate already exists either way.

---

## Implementation Units

### U1. Access-code gate
**Goal:** Require a fixed shared code before any order/run can be created.
**Requirements:** Stop budget burn from random visitors (KTD3).
**Dependencies:** none.
**Files:** `apps/web/app/api/session/route.ts` (validate code, set httpOnly cookie), `apps/web/app/page.tsx` (code entry before "Start"), a small `apps/web/app/components/access-gate.tsx`, `apps/web/lib/auth.ts` (cookie check helper), env `ACCESS_CODE`. Guard order creation in `apps/web/app/api/orders/route.ts`. Test: `apps/web/__tests__/access-gate.test.ts`.
**Approach:** Server compares submitted code to `process.env.ACCESS_CODE` (constant-time compare). On match, set signed httpOnly cookie; `/api/orders` POST rejects (401) without it. Landing page shows the code field until the cookie is present.
**Test scenarios:**
- Correct code → cookie set → `/api/orders` POST succeeds.
- Wrong/empty code → 401, no order row created, no run started (D5).
- Missing `ACCESS_CODE` env → fail closed (deny), logged.
- Cookie present on later requests → no re-prompt.
**Verification:** With the code, an order starts; without it, order creation returns 401 and no `orders` row or `/v1/runs` call happens.

### U2. Two-pane layout shell
**Goal:** Replace the vertical order page with a responsive chat-left / canvas-right shell.
**Requirements:** Lovable-style presentation (KTD1).
**Dependencies:** none (can land before panes are filled).
**Files:** `apps/web/app/order/[id]/page.tsx` (becomes a thin server wrapper passing initial state), new `apps/web/app/order/[id]/split-view.tsx` (client, two-pane grid), `apps/web/app/globals.css` if needed. Test: none (layout scaffold) — `Test expectation: none -- pure layout scaffold`.
**Approach:** Server component loads order/spec/ledger/events from SQLite (as today) and hands them to `split-view.tsx`, which renders a CSS grid: left pane (chat feed) + right pane (canvas). Collapses to stacked on mobile.
**Verification:** Order page renders two panes on desktop; all existing data still loads; no regression in state badges.

### U3. Chat-styled left pane
**Goal:** Render the Hermes activity + user actions as a chat feed with contextual inputs.
**Requirements:** Visible agentic autonomy (KTD1); reuse SSE.
**Dependencies:** U2.
**Files:** `apps/web/app/order/[id]/chat-pane.tsx`, reuse `event-timeline` logic + SSE at `apps/web/app/api/orders/[id]/events/route.ts`. Test: `apps/web/__tests__/chat-pane.test.tsx`.
**Approach:** Subscribe to the existing SSE stream; map each event (incl. `delegate_task`, `images_ready`, DFM pass/fail, Nemotron explanation) to a chat bubble. Render the stage-appropriate input inline (describe / revise / pay / approve) at the bottom.
**Test scenarios:**
- `delegate_task` event → "Hermaquette → Sculptor" bubble (B1).
- DFM fail→repair→pass events → visible transition bubbles (B2).
- Nemotron explanation event → narration bubble (B3).
- Stream reconnect mid-run → no duplicate bubbles (out-of-order/stale handling).
**Verification:** Running an order shows delegation, repair, and explanation beats as chat bubbles in order; the correct action input appears per state.

### U4. Progressive right canvas
**Goal:** Right pane shows concepts → revision variants → movable 3D → money/pay/approval as state advances.
**Requirements:** KTD1; movable 3D.
**Dependencies:** U2; consumes U6 variants.
**Files:** `apps/web/app/order/[id]/canvas-pane.tsx` composing existing `concept-gallery`, `model-viewer-section`, `money-card`, `pay-button`, `vendor-approval`. Test: `apps/web/__tests__/canvas-pane.test.tsx`.
**Approach:** A state→view selector renders the right surface for the current `order.state` (concept | preview/manufacturable/quote → 3D + money | paid → approval). 3D stays orbit-movable via model-viewer.
**Test scenarios:**
- `concept` state → concept gallery in canvas.
- `preview`/`manufacturable` → 3D viewer + DFM result; viewer is orbit-interactive.
- `quote` → money card + pay; `paid` → vendor approval.
- Empty/first-run state → friendly placeholder, no crash.
**Verification:** As an order advances, the right pane swaps surfaces correctly and the 3D model is movable.

### U5. Optional reference-image upload
**Goal:** Let the user attach a reference image with the description to steer concept generation.
**Requirements:** image upload requested.
**Dependencies:** U1 (gated), feeds U6/concept-images.
**Files:** `apps/web/app/api/orders/route.ts` (accept multipart/file), upload handling to the `artifacts` volume, `apps/web/app/page.tsx` + `access-gate`/describe input (file picker), pass image path into the order row; `hermes/skills/hermaquette/concept-images/scripts/run.js` (use the reference image if present). Test: `apps/web/__tests__/order-create-upload.test.ts`.
**Approach:** Store the upload under artifacts; persist its path on the order; `concept-images` includes it as an image input to Nano Banana when present (else text-only as today).
**Test scenarios:**
- Create order with image → file stored, path on order row, concept prompt includes it.
- Create order without image → unchanged text-only path (no regression).
- Oversized/invalid file type → rejected with a clear error, no order created.
**Verification:** An order created with a reference image stores it and the concept step reads it; without one, behavior is unchanged.

### U6. Capped concept-revision loop
**Goal:** After concepts appear, let the user request changes → new variants (≤3 revisions).
**Requirements:** revision loop (KTD2).
**Dependencies:** U3 (revise input), U4 (variant display).
**Files:** new `apps/web/app/api/orders/[id]/revise/route.ts` (kicks a revision run via `/v1/runs`), `hermes/skills/hermaquette/concept-images/scripts/run.js` (accept a revision prompt + `revision_n`, tag variants), `_shared/db.js`/`lib/db.ts` (store `revision_n` / variant grouping). Test: `apps/web/__tests__/revise.test.ts`, `hermes/skills/hermaquette/concept-images/__tests__/revise.test.js` (or script-level harness).
**Approach:** "Revise" submits a text delta; the web route triggers a scoped run that re-invokes `concept-images` with the revised prompt; new images are stored as the next variant set and surfaced as v2/v3. Enforce the cap server-side.
**Test scenarios:**
- Revise once → new variant set generated and shown; `revision_n` increments.
- Revise beyond cap (4th) → rejected; no extra Nano Banana call (KTD2 cap).
- Revise with no provider key → placeholder variants, still advances (D1).
- Concurrent double-submit of revise → single run, no duplicate variants (D6).
**Verification:** Requesting a change yields a new on-screen variant set; the 4th revision is refused; spend is bounded.

### U7. Reword "relief" → full-3D figure
**Goal:** Remove V1 "relief" language everywhere user-visible.
**Requirements:** copy consistency with the full-3D story.
**Dependencies:** none.
**Files:** `apps/web/app/order/[id]/*` (e.g., "front-facing relief", "Hermes built the 3D relief"), any `hermes/skills/hermaquette/*/SKILL.md` user-facing strings, landing copy. Test: `Test expectation: none -- copy only` (a grep check in review).
**Approach:** Find/replace relief phrasing with full-3D colored figure wording; keep rights/disclaimer text intact.
**Verification:** `grep -ri "relief"` over web + skills returns no user-facing matches.

### U8. Spike — stand up Stripe MCP server in Hermes
**Goal:** Decide the Workstream-B integration path by actually wiring Stripe's MCP server into Hermes config.
**Requirements:** KTD4; Stripe agent-tooling story.
**Dependencies:** none (timeboxed ~2 hrs).
**Files:** `~/.hermes/config.yaml` `mcp_servers` entry (via `services/hermes-agent/start.sh` so it's reproducible), `services/hermes-agent/Dockerfile` if the MCP server needs install. Test: manual — `Test expectation: none -- spike`.
**Approach:** Add Stripe's MCP server (hosted or local) to `mcp_servers`; confirm Hermaquette sees Stripe tools (`hermes` tool listing / a trial call in test mode). **Decision gate:** if tools appear and a test-mode call works within the timebox → proceed U9 via MCP; else → U9 via `@stripe/agent-toolkit` in the skill.
**Verification:** Either the agent lists/calls a Stripe MCP tool in test mode (go MCP), or the spike is declared failed and U9 takes the toolkit path — recorded in the unit's outcome.

### U9. Agent transacts via Stripe agent tooling, governance preserved
**Goal:** The customer payment link and the governed Issuing card are created through Stripe's agent tooling (MCP tool call or `@stripe/agent-toolkit`), still behind the cap+approval gate.
**Requirements:** KTD4; **must not** bypass governance.
**Dependencies:** U8 (path decision).
**Files:** `hermes/skills/hermaquette/vendor-checkout-gate/scripts/run.js` (issue the card via the toolkit/MCP path instead of raw SDK, keeping the fail-closed checks), optionally a payment-link step; `hermes/AGENTS.md` (instruct Hermaquette to use the Stripe tool only at the gated step); `apps/web/app/api/checkout/route.ts` if the customer link moves to the toolkit. Test: `hermes/skills/hermaquette/vendor-checkout-gate/__tests__/governance.test.js`.
**Approach:** Replace the raw-SDK Issuing call with a call through the chosen Stripe agent tool, leaving the **gate conditions identical** (`payment_confirmed_at` AND `checkout_approved=1` AND `vendor_cost ≤ SPEND_CAP_CENTS`). The agent's tool invocation is logged as a `delegations`/event row for the video (B4).
**Test scenarios:**
- All conditions met → Stripe tool issues the test card; event logged; state `checkout_approved`.
- Payment not confirmed → gate refuses; **no Stripe tool call**, no card, `checkout_blocked` (D4).
- `vendor_cost > SPEND_CAP_CENTS` → refused; no card (D4).
- Approval flag missing → refused; no card (D4).
- Stripe call fails/times out → safe fallback to SQLite record, no crash, gate state preserved (downstream-failure).
**Verification:** With a confirmed+approved order under cap, a test Issuing card is created via Stripe's agent tooling and the action is visible as an event; every negative condition blocks the Stripe call entirely.

---

## High-Level Technical Design

State → right-canvas surface (U4), driven by `order.state` from SQLite:

```
intake/research_done  → "Hermaquette is researching…" placeholder
concept               → concept gallery (+ revision controls, U6)
preview/manufacturable→ movable 3D viewer + DFM result (+ Nemotron note)
quote                 → 3D + money card + Pay (Stripe)
paid                  → vendor approval (governed Issuing, U9)
checkout_approved     → approved + shipping-gated note
```

Stripe governance gate (U9) — unchanged conditions, new transport:

```
pay confirmed? ──no──▶ checkout_blocked (no Stripe call)
   │yes
approved=1? ───no──▶ checkout_blocked (no Stripe call)
   │yes
cost ≤ cap? ───no──▶ checkout_blocked (no Stripe call)
   │yes
   ▼
Stripe agent tool (MCP / toolkit) issues test Issuing card ▶ checkout_approved
```

---

## Verification Flows

- **VF1. Success (UI):** With the access code, a user creates an order (optionally with a reference image), watches delegation/repair/Nemotron beats as chat bubbles (left), and concepts → revision → movable 3D → money/pay → approval in the canvas (right). Evidence: screen recording + `orders`/`events` rows.
- **VF2. Failure (auth):** Without the code, order creation returns 401 and no run starts. Evidence: API response + absence of `orders` row / `/v1/runs` call.
- **VF3. Failure (governance):** An order that is unpaid, unapproved, or over cap reaches the gate → `checkout_blocked`, **no Stripe tool call**, no card. Evidence: gate event row + Stripe dashboard shows no card.
- **VF4. Success (Stripe agentic):** A paid+approved under-cap order issues a test Issuing card **through Stripe's agent tooling**, logged as an event. Evidence: event row naming the tool + Stripe test dashboard card.

---

## Deferred to Implementation

- Exact cookie-signing helper and constant-time compare util (U1).
- Whether the revision run reuses the existing run or spawns a scoped one (U6) — decide against the `/v1/runs` contract at implementation time.
- Stripe MCP server exact package/endpoint + auth wiring (U8 spike resolves this).
- Whether the customer payment link also moves to the toolkit or stays on `/api/checkout` (U9).
