# Hermes Runtime Spike Findings

Date: 2026-06-26  
Plan: docs/plans/2026-06-26-002-refactor-native-hermes-agentic-cutover-plan.md

## Probe 1 — Child toolset for skills + terminal (I5/R-Risk3)

**Finding: Pass `toolsets=["terminal", "file", "web", "skills"]` to `delegate_task`.**

From `toolsets.py`:
- `DEFAULT_TOOLSETS = ["terminal", "file", "web"]` (delegate_tool.py:621)
- `"skills"` toolset is separate: `{"tools": ["skills_list", "skill_view", "skill_manage"]}` (toolsets.py:165)
- The `hermes-cli` composite toolset includes all of the above; when a parent runs under `hermes-cli`, it can pass individual named toolsets to children.
- Child receives the intersection of requested toolsets and parent's enabled toolsets (delegate_tool.py:1066–1078).

**Action for U1/U3:** AGENTS.md delegation templates must specify `toolsets=["terminal", "file", "web", "skills"]` in `delegate_task` calls for Sculptor and Follow-up.

**Terminal approval:** `write_approval: false` in config.yaml (already set in start.sh) suppresses dangerous-command approval pauses for the agent. Subagents inherit the gateway's approval mode (`tools/approval.py`). In gateway mode, approvals route through the run's approval queue — since `write_approval: false`, node script execution via terminal is auto-approved.

## Probe 2 — Delegation observability (B4/N1)

**Finding: Primary signal = child's own `delegations` DB write. `delegation.status` RPC is not confirmed on `:8642`.**

- `/v1/runs/{id}/events` (`_make_run_event_callback`) forwards only `tool.started`, `tool.completed`, `reasoning.available` and drops subagent/delegation events. Confirmed in api_server.py source.
- The child's own SQLite write (first action of each delegated child via `writeDelegation` in `_shared/db.js`) is the reliable, framework-independent proof-of-agency signal (N1).
- `delegation.status` as a gateway RPC is not surfaced on `:8642` in the current `api_server.py` — no such endpoint found. DB write stands alone.

**Action for U2:** `image-to-3d/scripts/generate.js` must call `writeDelegation({child_role: 'sculptor', status: 'started'})` as its first action; `dfm-repair/scripts/repair.js` must call `writeDelegation({status: 'completed'})` as its last action.

## Probe 3 — `response_id` shape + child isolation

**Finding: `run.completed` event does NOT include `response_id`. Run 2 must be orderId+SQLite-driven.**

From api_server.py (`_handle_runs`, lines ~4060–4070), the `run.completed` event shape is:
```json
{
  "event": "run.completed",
  "run_id": "<uuid>",
  "timestamp": 1234567890.0,
  "output": "<final agent text>",
  "usage": { ... }
}
```
No `response_id` field. The `_response_store` is keyed on response id from the `/v1/responses` path, not `/v1/runs`. There is no mechanism to retrieve the response id from a run event stream.

**Implication (B1 resolved):** `previous_response_id` cannot be reliably passed for Run 2. KTD5 is confirmed correct: Run 2 input carries `orderId`; agent re-reads SQLite. `orders.run1_response_id` column may be left NULL — it is optional narration-continuity only.

**Child isolation confirmed (code):**
- `agent/prompt_builder.py`: child agents instantiated with `skip_context_files=True`, `load_soul_identity=False` (delegate_tool.py:1247, agent_init.py:226).
- Children receive system prompt ONLY from `delegate_task(goal, context)` → `ephemeral_system_prompt`.
- SOUL.md and AGENTS.md are not accessible to children.

**Package path (`packages/image3d`):**
- The `hermes-worker/skills/image-to-3d.js` handler currently imports via `../../../../packages/image3d/adapter.js` (relative to `services/hermes-worker/`).
- Under the container layout, skill scripts live at `/hermes/skills/hermaquette/image-to-3d/scripts/generate.js` and packages at `/app/packages/image3d/` (per Dockerfile COPY).
- **Fix required (N4/N5):** `generate.js` must use the absolute container path `/app/packages/image3d/adapter.js` or a path relative to the script's actual location.

## Summary Table

| Question | Answer | Action |
|---|---|---|
| Child toolset for skills+terminal | `["terminal", "file", "web", "skills"]` | Add to AGENTS.md delegation templates |
| Terminal approval in children | Auto-approved (write_approval:false) | No change needed |
| Delegation observable via SSE | No — SSE drops subagent events | Use DB `delegations` row as primary signal |
| `delegation.status` RPC on :8642 | Not present | DB write stands alone |
| `response_id` in run.completed | Not present | Run 2 is orderId+SQLite, response_id optional |
| Child isolation | Confirmed (skip_context_files=True) | Delegation templates must be self-contained |
| packages/image3d path in container | Needs absolute path | Fix generate.js import to `/app/packages/image3d/` |
