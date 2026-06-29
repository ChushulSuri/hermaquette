#!/bin/bash
set -e

echo "[start] Configuring Hermes gateways..."
mkdir -p /root/.hermes/skills /root/.hermes-nemotron

# ── Determine primary model ───────────────────────────────────────────────────
# gpt-5.5 requires ChatGPT OAuth (HERMES_AUTH_JSON). Without it, auto-downgrade
# to an API-key-served model so the pipeline doesn't error on vanilla bring-up.
if [ -n "${HERMES_AUTH_JSON}" ]; then
  _hermes_model="${HERMES_LLM_MODEL:-gpt-5.5}"
  _reasoning_line="  reasoning_effort: ${HERMES_REASONING_EFFORT:-xhigh}"
  echo "[start] ChatGPT OAuth present — using model: $_hermes_model"
else
  _hermes_model="${HERMES_LLM_MODEL_API_FALLBACK:-gpt-4o}"
  _reasoning_line=""
  echo "[start] HERMES_AUTH_JSON absent — auto-downgraded to API model: $_hermes_model"
fi

# ── Primary Hermes gateway config (GPT-5.5/ChatGPT OAuth, or gpt-4o fallback) ─
cat > /root/.hermes/config.yaml <<EOF
model:
  provider: ${HERMES_LLM_PROVIDER:-openai}
  default: $_hermes_model
$_reasoning_line

auxiliary:
  vision:
    provider: ${HERMES_LLM_PROVIDER:-openai}
    model: $_hermes_model

memory:
  memory_enabled: true
  user_profile_enabled: false
  write_approval: false

skills:
  guard_agent_created: false
  write_approval: false

display:
  tool_progress: all
  streaming: false
EOF

# ── Stripe MCP server (agent-tooling story for judges) ────────────────────────
# Adds Stripe's official MCP server so the agent can issue cards and create
# payment links through Stripe's agent infrastructure.  The server is only
# started when STRIPE_SECRET_KEY is set and starts with sk_test_ or rk_test_.
if [ -n "${STRIPE_SECRET_KEY}" ] && echo "${STRIPE_SECRET_KEY}" | grep -qE '^(sk_test_|rk_test_)'; then
  cat >> /root/.hermes/config.yaml <<MCPF
mcp_servers:
  stripe:
    command: npx
    args: ["-y", "@stripe/mcp-server"]
    env:
      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY}
MCPF
  echo "[start] Stripe MCP server configured (test mode)"
else
  echo "[start] STRIPE_SECRET_KEY not set or not test-mode — Stripe MCP skipped"
fi

# ── Nemotron Hermes gateway config (NVIDIA — designated DFM/repair steps) ────
# Uses a separate HERMES_HOME so it holds its own credentials and config.
# OPENAI_API_KEY is passed as the provider key for the custom NVIDIA endpoint.
cat > /root/.hermes-nemotron/config.yaml <<EOF
model:
  provider: custom
  default: ${NEMOTRON_MODEL:-nvidia/llama-3.1-nemotron-70b-instruct}
  base_url: ${NEMOTRON_BASE_URL:-https://integrate.api.nvidia.com/v1}

memory:
  memory_enabled: false
  user_profile_enabled: false
  write_approval: false

skills:
  guard_agent_created: false
  write_approval: false

display:
  tool_progress: all
  streaming: false
EOF

# ── Primary gateway credentials ───────────────────────────────────────────────
if [ -n "${HERMES_AUTH_JSON}" ]; then
  echo "${HERMES_AUTH_JSON}" > /root/.hermes/auth.json
  echo "[start] ChatGPT OAuth credentials written to auth.json"
else
  echo "[start] HERMES_AUTH_JSON not set — Hermes will use OPENAI_API_KEY fallback"
  cat > /root/.hermes/.env <<HERMESENV
OPENAI_API_KEY=${OPENAI_API_KEY:-}
HERMESENV
fi

# ── Link hermaquette skills ───────────────────────────────────────────────────
if [ -d /hermes/skills/hermaquette ]; then
  ln -sfn /hermes/skills/hermaquette /root/.hermes/skills/hermaquette
  echo "[start] Linked hermaquette skills"
fi

# ── Re-create node_modules symlink (bind mount shadows Dockerfile's) ─────────
ln -sfn /app/node_modules /hermes/node_modules
echo "[start] Linked node_modules → /app/node_modules"

# ── Boot assert: verify ESM imports resolve from /hermes/skills/ ─────────────
# Probe from /hermes/ (not /app) to prove the symlink actually works
if ! cd /hermes && node --input-type=module -e "import('better-sqlite3').then(() => console.log('[start] ESM import check OK')).catch(e => { console.error('[start] FATAL: ESM import failed:', e.message); process.exit(1) })" 2>/dev/null; then
  echo "[start] FATAL: node_modules symlink not working — skill scripts will fail"
  exit 1
fi

# ── Start Nemotron Hermes gateway (port 8643) — only when key is available ────
NEMOTRON_GW_STARTED=0
if [ -n "${NEMOTRON_API_KEY}" ]; then
  echo "[start] Starting Nemotron Hermes gateway (NVIDIA) on port 8643..."
  HERMES_HOME=/root/.hermes-nemotron \
  OPENAI_API_KEY="${NEMOTRON_API_KEY}" \
  API_SERVER_ENABLED=true \
  API_SERVER_KEY="${HERMES_API_KEY:-hermaquette-local}" \
  API_SERVER_PORT=8643 \
  API_SERVER_HOST=127.0.0.1 \
  hermes gateway &
  NEMOTRON_GW_STARTED=1
else
  echo "[start] NEMOTRON_API_KEY not set — Nemotron steps will fall back to primary gateway"
fi

# ── Wait for Nemotron gateway ─────────────────────────────────────────────────
if [ "$NEMOTRON_GW_STARTED" -eq 1 ]; then
  for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:8643/health > /dev/null 2>&1; then
      echo "[start] Nemotron gateway ready after ${i}s"
      break
    fi
    sleep 1
  done
fi

# ── Write Hermaquette identity files ─────────────────────────────────────────
echo "[start] Writing SOUL.md and AGENTS.md..."
mkdir -p /root/.hermes
cp /hermes/SOUL.md /root/.hermes/SOUL.md
mkdir -p "${TERMINAL_CWD:-/app}"
cp /hermes/AGENTS.md "${TERMINAL_CWD:-/app}/AGENTS.md"
echo "[start] SOUL.md written to /root/.hermes/SOUL.md"
echo "[start] AGENTS.md written to ${TERMINAL_CWD:-/app}/AGENTS.md"

echo "[start] Starting Hermaquette agent (native Hermes, PID 1)..."
export API_SERVER_ENABLED=true
export API_SERVER_KEY="${HERMES_API_KEY:-hermaquette-local}"
export API_SERVER_PORT=8642
export API_SERVER_HOST=0.0.0.0
exec hermes gateway
