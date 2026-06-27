# Hermes Runtime Spike — Day-1 De-risking Findings

**Date:** 2026-06-26
**Plan ref:** `2026-06-26-002-refactor-native-hermes-agentic-cutover-plan.md` — Unit U7

---

## Probe 1: Child Toolset (I5 / R-Risk3)

**Question:** Which `enabled_toolsets` value lets a `delegate_task` child call `skill_view` + run a script via terminal?

### Key findings

**Blocked tools are stripped before the child is created.** The `DELEGATE_BLOCKED_TOOLS` frozenset at `tools/delegate_tool.py:45-54` permanently blocks:

```
delegate_task, clarify, memory, send_message, execute_code, cronjob
```

The `_strip_blocked_tools()` function (`tools/delegate_tool.py:769-786`) removes toolsets whose tools are all in the blocked set, plus the composite toolsets `delegation` and `code_execution`.

**What children DO get:** When a parent uses `enabled_toolsets=None` (all tools), the child inherits the parent's loaded tool names projected to their toolset names (`tools/delegate_tool.py:1051-1082`). The child gets:

- **`terminal`** toolset — `tools: ["terminal", "process"]` — YES, available. The child can run scripts.
- **`skills`** toolset — `tools: ["skills_list", "skill_view", "skill_manage"]` — YES, available. The child can call `skill_view`.
- **`file`** toolset — `tools: ["read_file", "write_file", "patch", "search_files"]` — YES, available.

**But `execute_code` is blocked.** The child cannot use the `execute_code` tool (it's in `DELEGATE_BLOCKED_TOOLS`). The child must use `terminal` to run scripts, which it CAN do.

**Terminal tool — no default `requires_approval` gate.** The terminal tool itself does not declare a `requires_approval` field in its registry entry. The dangerous-command system (`tools/approval.py`) gates specific *patterns* of commands (rm, sudo, etc.), not the tool generically. In subagent threads, dangerous commands are auto-denied by default (`_subagent_auto_deny` at `tools/delegate_tool.py:74`), but safe commands (running node scripts, etc.) execute without approval.

**Answer:** Use `enabled_toolsets=["skills", "terminal", "file", "web"]` (or any superset containing `skills` and `terminal`). The child inherits toolsets from the parent; when the parent uses `hermes-api-server` toolset (which includes all core tools), the child automatically gets `skills` and `terminal` in its resolved toolsets.

**However:** `execute_code` is always blocked for children. Use `terminal` to run node/python scripts.

**Source refs:**
- `tools/delegate_tool.py:45-54` — `DELEGATE_BLOCKED_TOOLS`
- `tools/delegate_tool.py:769-786` — `_strip_blocked_tools()`
- `tools/delegate_tool.py:1047-1082` — child toolset resolution
- `tools/delegate_tool.py:1229-1260` — child AIAgent construction (`skip_context_files=True`, `skip_memory=True`)
- `toolsets.py:153-157` — `terminal` toolset definition
- `toolsets.py:165-169` — `skills` toolset definition
- `toolsets.py:390-421` — `hermes-api-server` toolset (includes both)

---

## Probe 2: Delegation Observability (B4 / N1)

### 2a. Can a child agent write to SQLite?

**Yes, via terminal subprocess.** The child gets the `terminal` tool which executes arbitrary shell commands. A child can run `node -e "require('better-sqlite3')(...)" ` or `python3 -c "import sqlite3; ..."`. The child's terminal session is process-local (same container), so it can access SQLite databases at any path the container user can reach (e.g. `/db/` per the Dockerfile layout).

**Source refs:**
- `tools/terminal_tool.py:1008` — subagent terminal uses the same container environment
- `services/hermes-worker/Dockerfile:22` — `COPY db/ /db/`

### 2b. Is `delegation.status` reachable on gateway port `:8642`?

**No — `delegation.status` is only a TUI JSON-RPC method**, not an HTTP endpoint. It lives in `tui_gateway/server.py:7189-7206` as a `@method("delegation.status")` handler in the Ink (React) TUI backend. The API server (`gateway/platforms/api_server.py`) does NOT expose this method over HTTP.

**The API server's `/v1/runs` SSE stream is the only gateway observability surface.** The `:8642` port runs the TUI JSON-RPC backend, not the API server. The API server listens on a separate port (configurable via `gateway.api_server.port`).

**Answer:** `delegation.status` is NOT reachable via the HTTP gateway. It is only accessible through the TUI JSON-RPC protocol (stdio-based, used by `hermes --tui`). For HTTP-based delegation monitoring, the parent's SSE stream is the only path — and it drops subagent events (see 2c).

### 2c. Does the `/v1/runs/{id}/events` SSE stream forward delegation events?

**No.** The `_make_run_event_callback()` at `gateway/platforms/api_server.py:3795-3839` explicitly filters events:

```python
# Line 3837:
# _thinking and subagent_progress are intentionally not forwarded
```

It only forwards:
- `tool.started`
- `tool.completed`
- `reasoning.available`

The `subagent_progress` event (which carries delegation status from child agents) is **intentionally dropped**. The `_thinking` event is also dropped.

**Source refs:**
- `gateway/platforms/api_server.py:3795-3839` — `_make_run_event_callback()`
- `gateway/platforms/api_server.py:3837` — explicit comment about dropped events
- `tools/delegate_tool.py:657` — `subagent_progress` event type definition
- `tools/delegate_tool.py:929-942` — subagent progress relay

**Implication:** There is currently no way to observe child agent activity from the HTTP API. For our orchestration design, we'll need to either:
1. Add delegation events to the SSE callback filter, or
2. Have the child write status to SQLite and poll from the parent, or
3. Use a separate monitoring channel (the `delegation.status` JSON-RPC method via a TUI session).

---

## Probe 3: response_id + Isolation + Package Path

### 3a. Where does `response_id` surface in the completion event?

**`/v1/responses` (OpenAI Responses API):** The `response_id` is embedded in the response envelope. The `_envelope()` function at `gateway/platforms/api_server.py:2379-2387` generates:

```python
{
    "id": response_id,  # "resp_<uuid>"
    "object": "response",
    "status": "completed",
    "created_at": ...,
    "model": ...,
}
```

This envelope is emitted as `response.completed` (line 2816-2819):
```json
{"type": "response.completed", "response": {"id": "resp_...", "object": "response", ...}}
```

**`/v1/runs` (Hermes runs API):** The completion event is `run.completed` at `api_server.py:4058-4064`:
```json
{"event": "run.completed", "run_id": "run_<uuid>", "output": "...", "usage": {...}}
```

**`response_id` does NOT appear in the `run.completed` event.** It only has `run_id`. For the `/v1/responses` endpoint, the `response_id` is in `response.completed.response.id`.

**Source refs:**
- `gateway/platforms/api_server.py:2379-2387` — `_envelope()` includes `id` field
- `gateway/platforms/api_server.py:2816-2819` — `response.completed` event
- `gateway/platforms/api_server.py:4058-4064` — `run.completed` event (no response_id)

### 3b. Child agent isolation flags

**Confirmed.** In `tools/delegate_tool.py:1229-1260`, the child `AIAgent` is constructed with:

```python
child = AIAgent(
    ...
    skip_context_files=True,    # line 1247
    skip_memory=True,            # line 1248
    ...
)
```

**`load_soul_identity` is NOT explicitly set on the child.** The default value is `False` (defined at `agent/agent_init.py:226`). Combined with `skip_context_files=True`, the system prompt logic at `agent/system_prompt.py:154`:

```python
if agent.load_soul_identity or not agent.skip_context_files:
    # load SOUL.md
else:
    # use DEFAULT_AGENT_IDENTITY
```

Since `load_soul_identity=False` AND `skip_context_files=True`, the child gets the hardcoded `DEFAULT_AGENT_IDENTITY` — NOT the parent's SOUL.md.

**Answer:** Children always get `skip_context_files=True` and `load_soul_identity=False` (default). This is by design — children use a focused system prompt built from the goal + context, not the parent's project instructions.

### 3c. Container package path resolution

**The `packages/image3d/` directory is copied to `/app/packages/image3d/` in the container.** From `services/hermes-worker/Dockerfile:21`:

```dockerfile
COPY packages/ /app/packages/
```

The `adapter.js` file uses ES module imports with relative paths (`./budget.js`, `./fal_hunyuan3d.js`, `./fal_meshy.js`). These resolve relative to the file's own location, so they work correctly at `/app/packages/image3d/`.

**Import path from scripts:** If a script imports `from '/app/packages/image3d/adapter.js'`, it resolves. But the `adapter.js` file itself uses `import.meta.url` relative paths for fixtures (line 93):

```javascript
const here = dirname(fileURLToPath(import.meta.url))
const sampleStl = resolve(here, '../../fixtures/sample.stl')
```

This resolves to `/app/fixtures/sample.stl`. The `fixtures/` directory must exist at the container root level for this to work.

**Answer:** The `packages/image3d` imports resolve under the container path `/app/packages/image3d/`. The relative imports within the package work. External references from scripts should use `/app/packages/image3d/adapter.js`.

**Source refs:**
- `services/hermes-worker/Dockerfile:21` — `COPY packages/ /app/packages/`
- `packages/image3d/adapter.js:8-10` — relative imports (`./budget.js`, etc.)
- `packages/image3d/adapter.js:93-94` — `import.meta.url` fixture resolution

---

## Summary of Risk Signals

| Probe | Finding | Risk Level |
|-------|---------|------------|
| Child toolset | `skills` + `terminal` are available; `execute_code` is blocked | Low — `terminal` works for script execution |
| Delegation observability | SSE drops subagent events; `delegation.status` is TUI-only | **High** — no HTTP observability path exists |
| response_id in run.completed | Not present; only in `response.completed` via Responses API | Medium — must use Responses API endpoint |
| Child isolation | `skip_context_files=True`, `load_soul_identity=False` confirmed | Low — by design |
| Package paths | `/app/packages/image3d/` resolves; relative imports work | Low — Dockerfile layout matches |
