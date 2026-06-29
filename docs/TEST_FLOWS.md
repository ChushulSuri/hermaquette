# Hermaquette — Test Flows

What to test, in what order, with what to look for. Use this before recording the demo
and any time something changes. Live URL: the Coolify HTTPS domain.

> Status legend: ✅ working · ⚠️ needs a key/config · ⛔ not wired

## Current readiness (2026-06-29)

| Capability | Dep / key | Status |
|---|---|---|
| Orchestrator LLM (Hermaquette) | `HERMES_AUTH_JSON` (GPT‑5.5 OAuth) | ✅ wired |
| Concept images | `FAL_KEY` (gpt-image-2) | ✅ native Hermes tool |
| Image → 3D (geometry chain) | `FAL_KEY` (Hunyuan3D) | ✅ direct execution |
| DFM analysis/repair | cad-dfm service `:8000` | ✅ healthy |
| Nemotron DFM explanation | `NEMOTRON_API_KEY` (`:8643`) | ⚠️ empty → falls back to GPT‑5.5 |
| Real vendor quote | `SCULPTEO_API_KEY` | ⚠️ empty → fallback/recorded quote |
| Customer payment | `STRIPE_SECRET_KEY` (Checkout) | ⚠️ empty → pay step blocked |
| Governed Issuing card | `STRIPE_SECRET_KEY` + `STRIPE_ISSUING_ENABLED=true` | ⚠️ empty → SQLite-record fallback |
| Follow-up email | `AGENTMAIL_API_KEY` | ⚠️ optional |

---

## Flow A — Full happy path (the demo spine)

The 3-run lifecycle. SQLite is the source of truth; the web app is a thin `/v1/runs` client.

### Run 1 — Concept (intake → research → concepts)
1. Open the live URL, enter the **access code** (once the gate is built), type a description, pick a material, **Start**.
2. **Expect:** order created; state moves `intake → research_done → concept`.
3. **Verify:** `intake-research` runs (Hermaquette researches references); concept images are generated via **gpt-image-2** (native Hermes tool).
   - ✅ with `FAL_KEY`: real gpt-image-2 images. ⚠️ without: placeholder tiles (still advances).
4. **Action:** select one concept (and, once built, request a **revision** via chat input → new variants).

### Run 2 — Geometry (direct chain: image-to-3d → DFM repair → quote)
5. **Expect:** After concept approval, the geometry run executes **directly in sequence** (no sub-agent delegation):
   - `image-to-3d` (fal.ai Hunyuan3D) generates a **colored GLB**. State → `preview`.
   - `dfm-repair` runs the **repair loop** against cad-dfm: check fails → mesh repaired → PASS (watertight, wall thickness, size). State → `manufacturable`.
   - **Nemotron explains** the DFM result in plain English (⚠️ needs `NEMOTRON_API_KEY`, else GPT‑5.5 narrates).
   - `vendor-quote` → **Sculpteo** real material options + price + lead time. State → `quote`.
6. **Verify:** colored 3D model renders and is **orbit-movable**; money card shows **vendor cost + 10% fee → customer price**.

### Run 3 — Checkout (pay → governed vendor gate → address capture)
7. **Action:** pay via **Stripe test mode** (card `4242 4242 4242 4242`). State → `paid`.
8. `vendor-checkout-gate` runs the **governed Issuing** demo — **fail-closed unless** `payment_confirmed_at` set AND `checkout_approved=1` AND `vendor_cost ≤ SPEND_CAP_CENTS`. State → `checkout_approved`.
9. **Verify:** approval record written; address capture form appears (honest "send an address and it ships").

---

## Flow B — Visible-agentic-autonomy beats (record these for the video)

These are the moments the judges score. Each must be **visible on screen**, not narrated:
- **B1.** Direct geometry chain: the orchestrator runs image-to-3d → dfm-repair → vendor-quote in sequence (proof of deterministic agency).
- **B2.** The **DFM repair loop**: a check **FAIL → repair → PASS** transition, on camera.
- **B3.** **Nemotron explanation** text appears for the DFM result (the NVIDIA beat).
- **B4.** The **Stripe agentic** action: the agent creates the payment link / issues the governed card via Stripe's agent tooling — gated by cap + approval (Workstream B).
- **B5.** Independent proof-of-agency: the `delegations` table rows written by the **scripts' own** invocations (image-to-3d `started`, dfm-repair `completed`) — independent of SSE.

---

## Flow C — Per-dependency smoke checks (isolate failures fast)

Run these individually when a flow stalls:
- **C1. LLM:** create an order; if it never leaves `intake`, the gateway has no working model — check `hermes auth list` + config `model.default` (should be `openai-codex`).
- **C2. gpt-image-2:** concepts are real images, not `placehold.co` tiles.
- **C3. fal.ai:** a GLB artifact appears under `/artifacts` and renders in the viewer.
- **C4. cad-dfm:** `:8000/health` = 200; DFM report has watertight/wall-thickness/dimension fields.
- **C5. Nemotron:** DFM `explanation` reads like NVIDIA Nemotron, not the orchestrator.
- **C6. Sculpteo:** money card `quote_source` is the live API, not `manual`/recorded.
- **C7. Stripe:** Checkout redirects in test mode; Issuing card id appears in the gate event.

---

## Flow D — Failure / fallback paths (must fail safely)

- **D1. No `FAL_KEY`** → placeholder images; pipeline still advances. (no crash)
- **D2. No `SCULPTEO_API_KEY`** → quote falls back; money card labels it a recorded capture, not a live quote.
- **D3. DFM unmanufacturable** → order goes to `blocked`/`checkout_blocked` with a reason; no card issued.
- **D4. Governance gate negative:** pay NOT confirmed, or approval missing, or vendor cost > cap → **`checkout_blocked`, no Issuing card created**, no spend.
- **D5. Access-code gate (once built):** wrong/empty code → order creation rejected, no agent run started (no budget burned).
- **D6. Duplicate pay / double submit** → no double charge, no duplicate run.
- **D7. gpt-image-2 fails** → fallback to Nano Banana → placeholder; pipeline still advances.

---

## Pre-demo smoke checklist (run right before recording)

1. All 3 containers healthy; live URL returns 200.
2. `docker exec hermaquette-hermes-agent-1 cat /root/.hermes/config.yaml` shows `provider: openai-codex`, `reasoning_effort: high`, `approvals: mode: "off"`, no `mcp_servers`.
3. Keys present for the beats you'll show: FAL_KEY (gpt-image-2 + Hunyuan3D), Sculpteo, Stripe (+ Issuing), Nemotron.
4. One full Flow A run completes end-to-end with a colored, movable 3D model + real quote + governed checkout.
5. The video beats B1–B5 are each visible at least once.
