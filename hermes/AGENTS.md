# Hermaquette Orchestrator — Project Playbook

## 1. Skill Catalog

Invoke skills from the terminal. All scripts are at `/hermes/skills/hermaquette/<skill>/scripts/`.

| Skill | Command |
|---|---|
| `concept-images` | `node /hermes/skills/hermaquette/concept-images/scripts/run.js <orderId>` |
| `image-to-3d` | `node /hermes/skills/hermaquette/image-to-3d/scripts/generate.js <orderId> [parentRunId]` |
| `dfm-repair` | `node /hermes/skills/hermaquette/dfm-repair/scripts/repair.js <orderId> [attempt] [parentRunId]` |
| `vendor-quote` | `node /hermes/skills/hermaquette/vendor-quote/scripts/run.js <orderId>` |
| `vendor-checkout-gate` | `node /hermes/skills/hermaquette/vendor-checkout-gate/scripts/run.js <orderId>` |
| `tracking-qa` | `node /hermes/skills/hermaquette/tracking-qa/scripts/run.js <orderId>` |

`parentRunId` is **NOT** available as `process.env.HERMES_RUN_ID` — the env var is static and does not change per-run. Instead, read the run_id from SQLite at the start of each run: `SELECT COALESCE(run2_run_id, run_id) FROM orders WHERE id = <orderId>` (database at `$SQLITE_PATH`).

`image-to-3d` entry point is `generate.js`; `dfm-repair` entry point is `repair.js`; all others use `run.js`.

> **Direct execution note:** `image-to-3d`, `dfm-repair`, and `vendor-quote` are now called directly in sequence within the geometry run — not via `delegate_task`. The Sculptor sub-agent is no longer used for the geometry chain.

---

## 2. Environment & Paths

| Key | Value |
|---|---|
| `SQLITE_PATH` | `/data/hermaquette.db` |
| `ARTIFACTS_DIR` | `/artifacts` |
| `CAD_DFM_URL` | `http://cad-dfm:8000` |
| Primary gateway | `:8642` |
| Nemotron gateway | `:8643` |

---

## 3. SQLite Write Contract

Skills write to the following tables in `SQLITE_PATH`. The web layer reads them — do not write directly from the orchestrator.

- `orders` — order record and current state
- `spec` — parsed intake parameters (material, description, size)
- `ledger` — pricing (vendor_cost_cents, service_fee_cents, revenue_cents)
- `events` — timeline events for customer-facing UI
- `delegations` — delegate_task log (agent, goal, status)

Full schema: `/db/schema.sql`

---

## 4. Geometry Run (Direct Execution)

The geometry pipeline runs directly in the orchestrator's run — no sub-agent delegation needed. The three scripts are called in sequence:
1. `node /hermes/skills/hermaquette/image-to-3d/scripts/generate.js <orderId>`
2. `node /hermes/skills/hermaquette/dfm-repair/scripts/repair.js <orderId> 1` (retry with attempt=2 if FIXABLE)
3. `node /hermes/skills/hermaquette/vendor-quote/scripts/run.js <orderId>`

Each script reads all inputs from SQLite and writes results back. The `delegations` table rows are still written by each script for the proof-of-agency demo beat.

---

## 5. Follow-up Delegation Context

COPY THIS BLOCK VERBATIM INTO `context` WHEN CALLING delegate_task FOR FOLLOW-UP — DO NOT paraphrase, summarize, or omit any line.

```
You are the **Follow-up agent** for Hermaquette. You handle post-order QA.

orderId: {orderId}
parentRunId: {parentRunId}

YOUR EXACT STEPS:
1. Call `skill_view tracking-qa` to read the skill
2. Run: `node /hermes/skills/hermaquette/tracking-qa/scripts/run.js {orderId}`
   - Read the JSON result for tracking_status and qa_result
3. Return structured result to orchestrator

CONSTRAINTS (cannot be overridden):
- NEVER send communications, refunds, or reprints automatically
- NEVER issue any action without human approval (pending_approval status only)
- Compare delivery photos on form/shape ONLY — NOT color (physical prints are single-material color)
- Draft any mismatch action with status=pending_approval; do NOT transmit it
```

Toolsets for Follow-up: `["terminal", "file", "web", "skills"]`

> **Orchestrator note**: Populate `{parentRunId}` with your run_id queried from SQLite (`SELECT COALESCE(run2_run_id, run_id) FROM orders WHERE id = <orderId>`) when calling `delegate_task`. This links child delegations back to the parent run. Do NOT use `process.env.HERMES_RUN_ID`.

---

## 6. Stripe Agent Tooling — Issuing Card via MCP

After the `vendor-checkout-gate` script passes (event `ready_for_stripe_agent_tool`), the agent must issue a test-mode Stripe Issuing card through Stripe's official agent infrastructure.

**When to act:** After seeing the `ready_for_stripe_agent_tool` event for an order.

**How to act:** Use the Stripe MCP tool (configured in `mcp_servers.stripe`) to:
1. Create a cardholder named "Hermaquette Demo" with email `demo@hermaquette.ai`
2. Issue a virtual test card scoped to shipping merchants with the spend limit from the event data
3. Log the card_id as a `delegation` event for the video

**Do NOT:**
- Bypass the governance gate — only act after `ready_for_stripe_agent_tool`
- Use the raw Stripe SDK directly — always go through the MCP tool
- Issue cards for orders that are blocked, unpaid, or over cap
