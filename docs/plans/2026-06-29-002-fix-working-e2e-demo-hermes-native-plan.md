---
title: "fix: Working end-to-end demo — Hermes-native tools + persisted fixes"
status: active
date: 2026-06-29
type: fix
depth: deep
---

# fix: Working end-to-end demo — Hermes-native tools + persisted fixes

## Summary

An extensive live browser+API test of Hermaquette uncovered a cascade of bugs that I patched on the running container to keep the demo URL alive, but which are **not persisted** (a container recreate loses them). This plan: (1) bakes every live fix into the repo/images for a clean reproducible deploy, (2) fixes the **Run‑2 geometry stall** by having the orchestrator run the pipeline steps **directly/deterministically** instead of the fragile `delegate_task` sub-agent hand-off, (3) shifts to **Hermes-native built-in tools** wherever they exist (image generation, web research) and keeps custom skills only where Hermes has no built-in (3D gen, DFM, vendor quote, Stripe gate), and (4) repairs the split-lane UI so the full flow is drivable **in the browser**, ending in a verified end-to-end run.

Deadline is EOD 2026-06-30. The work is ordered so a **working end-to-end browser demo is reachable fastest**, with the riskiest piece (the Run‑2 refactor) called out.

---

## Problem Frame

The live test proved the front of the pipeline works but the rest is blocked by latent bugs the prior "build verified clean" never caught:

**Works:** access-code gate (fail-closed), split-lane order form + image upload, order creation, and **Run 1 fully autonomous** (orchestrator gpt‑5.5 → intake-research → concept-images → concepts ready).

**Broken / blocking:**
1. **Run‑2 (geometry) stalls** — even at `reasoning: high`, the orchestrator views skills and reasons for 5+ min but never completes the `delegate_task` hand-off to the Sculptor sub-agent: no `delegations` row, no image‑to‑3d, no fal call. The delegation contract (verbatim-copy context blocks + per-run SQLite `parentRunId` queries) is too fragile for reliable autonomous execution.
2. **8 fixes are live-only** (container patches), lost on recreate: web image missing `db/schema.sql` (→ `no such table: orders` 500), `HERMES_LLM_PROVIDER` must be `openai-codex` not `openai`, `DEMO_TOKEN` mismatch, Stripe MCP `@stripe/mcp-server` 404 that **hangs every run**, `approvals.mode: manual` blocking all tool execution, `reasoning_effort: xhigh` far too slow. (Already committed: the `platforms:[hermes]` SKILL.md fix.)
3. **Concept images are placeholders** — the custom Nano Banana fetch fails; Hermes has a native `image_generate` tool (gpt-image-2) that should be used instead.
4. **Split-lane UI is incomplete** — the right canvas renders no concept gallery/select control (selection had to be driven via API), the left chat shows raw event types (`message.delta`, `undefined: tool.started`), and SSE is stuck "Connecting…".

**Architectural directive (user):** prefer **Hermes's built-in features** over custom code. Research confirms native tools exist for **image generation** (`image_generate`, toolset `image_gen`, gpt-image-2 via FAL) and **web research** (`web_search`/`web_extract`, toolset `web`). No native tool exists for image→3D, mesh DFM, vendor quote, or Stripe Issuing — those stay as custom skills.

---

## Key Technical Decisions

- **KTD1 — Run‑2 runs deterministically, no sub-agent delegation.** The orchestrator (or a single linear skill chain) invokes `image-to-3d` → `dfm-repair` → `vendor-quote` **directly in sequence** within one run, instead of `delegate_task` to a Sculptor sub-agent. Rationale: the delegation hand-off is the proven stall point; a direct deterministic chain is reliable. The `delegations` table rows are still written by the child scripts, so the proof-of-agency demo beat survives without sub-agents. **This is the riskiest unit.**
- **KTD2 — Use Hermes-native tools where they exist; custom skills only where they don't.** Concept generation → native `image_generate` (gpt-image-2, medium quality). Intake research → native `web_search`/`web_extract`. Keep custom: `image-to-3d` (Hunyuan3D — no native 3D tool), `dfm-repair` (cad-dfm service), `vendor-quote` (Slant3D), `vendor-checkout-gate` (Stripe Issuing). Rationale: user directive + less brittle custom code; the native image tool also fixes the placeholder problem (it routes through the same FAL billing we already fund).
- **KTD3 — Remove the Stripe MCP entirely.** `@stripe/mcp-server` is a 404 that hangs every run. Stripe still demos via the existing SDK-based Issuing gate (`vendor-checkout-gate`) + Checkout. Rationale: the MCP added a hang for zero working benefit; the real package `@stripe/mcp` is unproven under deadline. (Documented as a deferred follow-up.)
- **KTD4 — All config baked into `start.sh` + Dockerfiles, deployed via a documented manual script.** `approvals.mode: off`, `reasoning_effort: high`, `HERMES_LLM_PROVIDER=openai-codex`, image+web toolsets enabled, schema in the web runner stage. Rationale: Coolify's build wrapper exits 255, so we build+`compose up --no-build` manually; everything must be in the image so a recreate is safe.
- **KTD5 — `image_gen`/`web` toolsets enabled for the run.** The native tools only appear to the agent when their toolset is enabled (config `toolsets`/`enabled_toolsets`). Without this, `image_generate` isn't callable. Rationale: discovered in `image_generation_tool.py` (`toolset="image_gen"`).

---

## Scope Boundaries

**In scope:** persist all 8 live fixes into repo/images; remove Stripe MCP; deterministic Run‑2 chain; native `image_generate` concepts + native web research; fix canvas-pane (concept gallery/select, 3D, money, pay, approval), chat-pane (clean bubbles), SSE live updates; documented manual build+deploy script; full end-to-end browser verification.

**Deferred to Follow-Up Work:** Stripe MCP via the real `@stripe/mcp` package; multi-view/multi-angle 3D (Hunyuan3D is single-image; the rotatable preview already shows all angles); fixing Coolify's native build; real two-way conversational chat; persisting MEMORY.md lessons.

**Out of scope / non-goals:** product redesign; changing the 3-run lifecycle conceptually; replacing custom 3D/DFM/quote/Stripe skills that have no Hermes-native equivalent; live (non-test) payments.

---

## Triage — must-fix vs nice-to-have

- **Must-fix for a working demo (block the flow):** U1 web schema, U2 provider, U3 remove MCP, U4 approvals+reasoning, U5 deterministic Run‑2, U6 native image concepts, U8 canvas concept-select. Without all of these, the browser demo cannot complete.
- **Strongly wanted (camera quality):** U9 chat bubbles + U10 SSE live updates (otherwise the "agent working" beats look broken on screen).
- **Nice-to-have:** U7 native web research (intake already works via the custom skill; switching is the user's directive but not flow-blocking — can be cut if time is short).
- **Riskiest:** **U5** (deterministic Run‑2 refactor) — it's the unknown. Do it early; if it resists, the fallback is a thinner orchestrator prompt that calls the three skills in one run without any sub-agent.

---

## Implementation Units

> Ordered so a working end-to-end browser demo is reachable fastest: deploy-reliability + pipeline first (U1–U6), then UI (U8–U10), then verify (U11). U7 is optional.

### U1. Persist web DB schema into the runner image
**Goal:** The web container's runtime DB gets its tables, eliminating the `no such table: orders` 500.
**Requirements:** deploy reliability (Problem #2).
**Dependencies:** none.
**Files:** `apps/web/Dockerfile` (copy `db/schema.sql` into the **runner** stage, matching a path `apps/web/lib/db.ts` already probes — e.g. `/db/schema.sql` or `/app/db/schema.sql`).
**Approach:** `lib/db.ts` already applies schema from several candidate paths on first open; the builder stage has it but the runner stage doesn't. Add the COPY to the runner stage. Verify against `lib/db.ts`'s candidate list so the path matches.
**Test scenarios:**
- Fresh web container + empty DB → first `/api/orders` POST creates an `orders` row (no SQLite error).
- Re-open existing DB → schema apply is idempotent (no error, no data loss).
**Verification:** A newly built+started web image creates an order with no `no such table` error; `.tables` shows the full schema.

### U2. Persist Hermes LLM provider = openai-codex
**Goal:** Runs use gpt‑5.5 via the OAuth credential instead of failing with "Unknown provider 'openai'".
**Requirements:** Problem #2.
**Dependencies:** none.
**Files:** `services/hermes-agent/start.sh` (config `model.provider`), `.env.example` / compose default `HERMES_LLM_PROVIDER=openai-codex`.
**Approach:** start.sh writes `provider: ${HERMES_LLM_PROVIDER:-openai-codex}`. Confirm the credential's provider id via `hermes auth list` (it is `openai-codex`).
**Test scenarios:**
- Container boot → `config.yaml` shows `provider: openai-codex`, `default: gpt-5.5`.
- Create an order → run starts (no `run.failed: Unknown provider`).
**Verification:** A run completes Run 1 with no provider error in logs.

### U3. Remove the Stripe MCP server
**Goal:** No `npx @stripe/mcp-server` 404 hang at run start.
**Requirements:** Problem #2 (KTD3).
**Dependencies:** none.
**Files:** `services/hermes-agent/start.sh` (delete the `mcp_servers:` block it appends).
**Approach:** Remove the MCP config generation entirely. Stripe stays via `vendor-checkout-gate` SDK + Checkout. Leave a comment pointing to the deferred `@stripe/mcp` follow-up.
**Test scenarios:**
- Container boot → `config.yaml` has no `mcp_servers`.
- A geometry/checkout run proceeds without hanging on npx.
**Verification:** No `mcp`/`npx` process and no run stall attributable to MCP; logs show no MCP startup.

### U4. Persist approvals=off + reasoning=high
**Goal:** The agent executes its tools/skills autonomously, at a usable speed.
**Requirements:** Problem #2.
**Dependencies:** none.
**Files:** `services/hermes-agent/start.sh` (append `approvals:\n  mode: "off"`; set `reasoning_effort: ${HERMES_REASONING_EFFORT:-high}`), compose default `HERMES_REASONING_EFFORT=high`.
**Approach:** Default mode `manual` blocks every skill/terminal call awaiting human approval that nothing grants. `off` lets the autonomous agent run. (User-approved security trade-off; container is internal-only, test-mode.) `xhigh` → `high` for speed.
**Test scenarios:**
- Boot → config shows `approvals.mode: "off"` and `reasoning_effort: high`.
- Create an order → skills execute without an `approval.request` stall.
**Verification:** Run 1 reaches `concept` autonomously with no approval block; per-step latency materially lower than xhigh.

### U5. Deterministic Run‑2 geometry chain (riskiest)
**Goal:** The geometry run reliably reaches `preview → manufacturable → quote` without the sub-agent delegation stall.
**Requirements:** Problem #1 (KTD1).
**Dependencies:** U2, U4 (agent must run tools first).
**Files:** `hermes/agents/hermaquette-orchestrator/AGENT.md`, `hermes/AGENTS.md`, `hermes/agents/sculptor/AGENT.md` + `hermes/agents/followup/AGENT.md` (simplify/retire the delegate contract), the geometry dispatch input in `apps/web/app/api/orders/[id]/route.ts` (the `approve_concept` branch's run instructions).
**Approach:** Replace the "delegate to Sculptor, copy this context verbatim, query parentRunId" instructions with a direct linear instruction: read approved image from SQLite, then run `image-to-3d/scripts/generate.js`, then `dfm-repair/scripts/repair.js`, then `vendor-quote/scripts/run.js`, in order, in this run. Child scripts still write their own `delegations` rows for the proof-of-agency beat. Keep state transitions owned by the scripts/SQLite. **Fallback if it still stalls:** an even thinner orchestrator prompt or a single wrapper skill that shells the three scripts in sequence.
**Execution note:** Validate by dispatching one real geometry run end-to-end before considering the unit done — this is the unit most likely to need iteration.
**Test scenarios:**
- Approve a concept → within one run, `delegations` gets `image-to-3d` then `dfm-repair` rows; order reaches `quote`.
- image‑to‑3d returns a GLB → order state `preview` then `manufacturable` after DFM PASS.
- fal/image‑to‑3d hard error (e.g. no credit) → order goes to a clean `error`/`blocked` with a reason, not an indefinite `geometry_pending` stall.
- DFM unrepairable → `blocked` with reason; no quote.
**Verification:** A real approve→geometry run reaches `quote` with a GLB artifact and a Slant3D quote in the ledger; the stall (5+ min at `geometry_pending`, zero delegations) does not recur.

### U6. Native concept generation via `image_generate` (gpt-image-2)
**Goal:** Real concept images (not placeholders), generated through Hermes's built-in tool.
**Requirements:** Problem #3 (KTD2, KTD5).
**Dependencies:** U4, U5 (toolset enablement shares the config path).
**Files:** `hermes/skills/hermaquette/concept-images/scripts/run.js` (or the orchestrator instruction) to use the native `image_generate` tool / gpt-image-2 FAL endpoint at `medium` quality; `services/hermes-agent/start.sh` (enable `image_gen` toolset); keep Nano Banana as fallback, placeholder last.
**Approach:** Two viable shapes — (a) have the **orchestrator call the native `image_generate` tool** for 3–4 front-facing variations and write the resulting URLs to SQLite via a thin script, or (b) keep the skill but replace the Nano Banana fetch with a `fal-ai/gpt-image-2` call (reuse the fal pattern from `image-to-3d/scripts/generate.js`). Prefer (a) per the Hermes-native directive; fall back to (b) if wiring the tool's output into SQLite is fiddly. 3–4 design variations (current behavior); not multi-angle.
**Test scenarios:**
- Create an order → concept event `images_ready` has 3–4 images with `source` = gpt-image-2 (not `placeholder`).
- gpt-image-2 fails → Nano Banana fallback; both fail → placeholder, pipeline still advances.
- Cost guard: `medium` quality, ≤4 images per generation.
**Verification:** A real order shows real rendered concept images in the gallery; event data `source` is the FAL/gpt-image-2 path.

### U7. Native web research for intake (optional)
**Goal:** Intake-research uses Hermes-native `web_search`/`web_extract` instead of custom code.
**Requirements:** KTD2 (user directive); non-blocking.
**Dependencies:** U4.
**Files:** `hermes/skills/hermaquette/intake-research/*`, `services/hermes-agent/start.sh` (enable `web` toolset), orchestrator instruction.
**Approach:** Have the orchestrator use native `web_search`/`web_extract` to gather references during intake; retire the custom research fetch where the native tool covers it.
**Test scenarios:**
- Create an order → intake produces research notes via native web tools (event/log shows web_search use).
- Web tool unavailable → intake still completes (degrade gracefully).
**Verification:** An order's intake step shows native web tool usage and still advances to `concept`. *(Cut this unit if time is short — intake already works.)*

### U8. Canvas-pane renders concept gallery + select (and the rest of the flow)
**Goal:** The browser shows the concept gallery with a working select control at `state=concept`, then the 3D viewer, money card+pay, and approval at the right states.
**Requirements:** Problem #4 (UI must drive the flow, not the API).
**Dependencies:** none (parallel with backend), but verified against U5/U6 output.
**Files:** `apps/web/app/order/[id]/canvas-pane.tsx` (+ existing `concept-gallery.tsx`, `model-viewer-section.tsx`, `money-card.tsx`, `pay-button.tsx`, `vendor-approval.tsx`). Test: `apps/web/__tests__/canvas-pane.test.tsx`.
**Approach:** State→surface selector: `concept` → ConceptGallery with select (posts `approve_concept`); `preview`/`manufacturable` → 3D viewer (+DFM result/Nemotron note); `quote` → money card + pay; `paid` → vendor approval; `checkout_approved` → confirmation. Fix the current empty render at `concept`.
**Test scenarios:**
- `state=concept` with images → gallery + select control visible; selecting posts `approve_concept` and advances.
- `state=preview/manufacturable` → orbit-movable 3D viewer renders the GLB.
- `state=quote` → money card (vendor cost + fee + price) + pay button.
- `state=paid` → vendor approval panel.
- Empty/first-run → friendly placeholder, no crash.
**Verification:** A full browser run is drivable with no API workaround: select concept → see 3D → see quote → pay → approve.

### U9. Chat-pane clean activity bubbles + revision input
**Goal:** The left pane reads as a clean activity feed AND lets the user request concept revisions in-browser.
**Requirements:** Problem #4 (camera quality) + revision UX.
**Dependencies:** none.
**Files:** `apps/web/app/order/[id]/chat-pane.tsx`, posts to existing `apps/web/app/api/orders/[id]/revise/route.ts`. Test: `apps/web/__tests__/chat-pane.test.tsx`.
**Approach:** (a) Map event types to human bubbles; collapse `message.delta` streams into one assistant message; format `reasoning.available`; never render `undefined: …`; surface the demo beats (skill activity, DFM pass, Nemotron explanation) as readable lines. (b) Add a **text input** at `state=concept` so the user can type a revision ("make it taller / rounder…") → posts to the revise API (max 3, server-enforced) → new concept variants appear in the canvas. The revise backend already exists; this wires the UI to it.
**Test scenarios:**
- A burst of `message.delta` → one coalesced assistant bubble, not N rows.
- `tool.started/completed` → a readable "running X" line, never `undefined:`.
- DFM pass + Nemotron explanation events → clearly labeled bubbles.
- At `concept`, typing a revision + send → revise API called, new variants render; 4th revision rejected with a message.
- Revise input hidden when not in `concept` state.
**Verification:** During a live run the left pane shows clean, ordered activity AND the user can revise concepts from the browser without the API.

### U10. SSE live state updates
**Goal:** The order page updates live (no stuck "Connecting…"); badge + panes advance as state changes.
**Requirements:** Problem #4.
**Dependencies:** U8, U9.
**Files:** `apps/web/app/api/orders/[id]/events/route.ts`, `apps/web/app/order/[id]/chat-pane.tsx` (subscription), `apps/web/app/order/[id]/split-view.tsx` if it holds shared state.
**Approach:** Diagnose why the client stays "Connecting…" and the server-rendered state goes stale (subscription not opening, or events not flushing, or client not re-fetching state on key events). Ensure `images_ready`/`concept_approved`/state-change events trigger a UI refresh of the canvas without a manual reload. Handle reconnect without duplicate bubbles.
**Test scenarios:**
- Run an order → left pane shows "Live" and bubbles stream in without reload.
- State `concept → preview → quote` → right canvas swaps surfaces live.
- Reconnect mid-run → no duplicate bubbles, state consistent.
**Verification:** A full run progresses on screen with no manual refresh.

### U11. Documented manual build+deploy script + end-to-end verification
**Goal:** A repeatable deploy that bakes all fixes, plus a verified full browser run.
**Requirements:** deploy reliability + Problem #1–#4 closure (VF1).
**Dependencies:** U1–U6, U8–U10.
**Files:** `scripts/deploy-droplet.sh` (or `docs/DEPLOY.md`), update `docs/TEST_FLOWS.md` with the confirmed result.
**Approach:** Script: clone at commit → `docker build` web + hermes-agent → retag to the compose image tags → `docker compose --env-file .env up -d --no-build --force-recreate web hermes-agent` → reconnect web to the `coolify` proxy network → restart `coolify-proxy` → health-check all three. Then run the full flow in the browser and capture screenshots of each beat.
**Test scenarios:**
- Run the script on a clean checkout → all three containers healthy, site 200, **no live patches needed**.
- Recreate the hermes-agent container → approvals/provider/reasoning/no-MCP all survive (config regenerated correctly).
**Verification (VF — end-to-end):** Browser: enter access code → describe → **gpt-image-2 concepts** → select → **Hunyuan3D 3D (movable)** → **DFM + Nemotron explanation** → **Slant3D quote** → **Stripe test pay** → **governed Issuing/SQLite checkout gate** → **address capture**. Evidence: screenshots of each beat + SQLite state (`orders.state` reaching `checkout_approved`, `delegations` rows, `ledger` quote, captured address).

### U12. Address-capture panel after approval (no order placed)
**Goal:** After the user approves the governed checkout, capture a shipping address live — to make the gated ending tangible — **without placing any Slant3D order or shipping anything**.
**Requirements:** demo storytelling (the honest "send an address and it ships" beat); user will not pre-fill it.
**Dependencies:** U8 (canvas renders the `checkout_approved` surface).
**Files:** `apps/web/app/order/[id]/canvas-pane.tsx` (render at `state=checkout_approved`), new `apps/web/app/order/[id]/address-capture.tsx`, new `apps/web/app/api/orders/[id]/address/route.ts` (store only), `apps/web/lib/db.ts` (optional `ship_to` column / reuse spec). Test: `apps/web/__tests__/address-capture.test.ts`.
**Approach:** At `checkout_approved`, show an address form (name, street, city, state, zip, country). On submit, POST to a store-only route that writes the address to SQLite and emits a `ship_to_captured` event → UI confirms "✓ Address received — this is where it would ship. (No order placed; nothing ships in the demo.)". **Explicitly NO call to Slant3D `/api/order`; no payment; no fulfillment.** Access-code gated like the other mutations.
**Test scenarios:**
- At `checkout_approved`, submit a valid address → stored in SQLite, confirmation shown, **no Slant3D order call** made.
- Missing required fields → inline validation, no store.
- Submit before `checkout_approved` → rejected (wrong state).
- No access cookie → 401, nothing stored.
**Verification:** Entering an address after approval shows the confirmation and writes a `ship_to`/event row; logs/network show **no** `slant3dapi.com/api/order` request and no charge.

---

## High-Level Technical Design

**Run‑2 change (KTD1): delegation → deterministic chain**

```
BEFORE (stalls):
  orchestrator --delegate_task(sculptor, verbatim context, parentRunId query)--> [STALL: no delegation row]

AFTER (deterministic, one run):
  approve_concept → geometry run:
    read approved_image_url (SQLite)
      → node image-to-3d/generate.js   → GLB/STL, state=preview   (+delegations row)
      → node dfm-repair/repair.js       → PASS/repair, state=manufacturable (+Nemotron explain, +delegations row)
      → node vendor-quote/run.js        → Slant3D price, state=quote (+ledger)
    STOP (await pay)
```

**Tool sourcing (KTD2): native vs custom**

```
NATIVE Hermes tools (enable toolset, agent calls directly):
  • image_generate (image_gen)  → concept images (gpt-image-2, medium)
  • web_search / web_extract (web) → intake research        [U7, optional]
CUSTOM skills (no native equivalent — keep):
  • image-to-3d (Hunyuan3D / FAL)   • dfm-repair (cad-dfm service)
  • vendor-quote (Slant3D)          • vendor-checkout-gate (Stripe Issuing)
REMOVED:
  • Stripe MCP (@stripe/mcp-server 404 hang)
```

**State → right-canvas surface (U8)**

```
concept              → concept gallery + SELECT (posts approve_concept)
preview/manufacturable → movable 3D viewer (+DFM/Nemotron)
quote                → money card + Pay (Stripe test)
paid                 → governed vendor approval (Issuing/SQLite gate)
checkout_approved    → confirmation + shipping-gated note
```

---

## Verification Flows

- **VF1. Success (end-to-end browser):** Access code → describe owl figure → real gpt-image-2 concepts → select → movable 3D → DFM PASS + Nemotron explanation → Slant3D quote → Stripe test pay (4242…) → governed checkout gate → `checkout_approved`. Evidence: per-beat screenshots + SQLite (`orders.state`, `delegations`, `ledger`).
- **VF2. Failure (Run‑2 hard error):** With fal at zero credit (or forced error), the geometry run goes to a clean `error`/`blocked` with a reason — **not** an indefinite `geometry_pending` stall. Evidence: order state + error event.
- **VF3. Failure (deploy recreate):** Recreate the hermes-agent container → `approvals.mode: off`, provider `openai-codex`, `reasoning: high`, no MCP all persist (regenerated by start.sh). Evidence: `config.yaml` dump + a successful run, no live patching.
- **VF4. Failure (concept provider down):** gpt-image-2 fails → Nano Banana fallback → placeholder; pipeline still advances; the UI/agent labels it honestly. Evidence: `images_ready` event `source` + order still reaches `concept`.
- **VF5. Failure (access gate):** No/!wrong access code → order creation 401, no `orders` row, no run. Evidence: API response + DB.

---

## Risks & Dependencies

- **R1 (high) — Run‑2 deterministic chain (U5) may still misbehave** under gpt‑5.5 even without delegation (e.g., agent doesn't run all three scripts, or ordering drifts). Mitigation: explicit linear instructions + the single-wrapper-skill fallback; validate with a real run before moving on. This is the one unknown that could consume the deadline.
- **R2 (med) — FAL budget.** $10 funds gpt-image-2 concepts (~$0.05×4/order) **and** Hunyuan3D 3D. Repeated full-run testing burns it; keep test runs few and use `medium` quality.
- **R3 (med) — Native `image_generate` output → SQLite wiring.** The tool returns image URLs to the agent; persisting them into the concept event/SQLite may need a thin script bridge (U6 shape (a) vs (b)).
- **R4 (low) — Live deploy disruption.** All recreates target web+hermes-agent only and reconnect the proxy; cad-dfm + volumes untouched. Don't click Coolify Deploy/Stop.

---

## Deferred to Implementation

- Exact runner-stage COPY path in `apps/web/Dockerfile` (match `lib/db.ts`'s candidate list at implementation time).
- Whether U6 lands as orchestrator-calls-`image_generate` (preferred) or skill-calls-`fal-ai/gpt-image-2` (fallback) — decide when wiring the tool output into SQLite.
- Exact toolset-enable config key (`toolsets:` vs `enabled_toolsets:`) for `image_gen`/`web` — confirm against the gateway config loader.
- Root cause of the SSE "Connecting…" stall (U10) — diagnose against the events route at implementation time.
- The Run‑2 fallback shape (thin prompt vs single wrapper skill) — choose only if the direct chain still stalls.
