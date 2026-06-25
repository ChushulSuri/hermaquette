#!/bin/bash
set -e

echo "[start] Configuring Hermes..."
mkdir -p /root/.hermes/skills

# Write config.yaml — provider and model from env
cat > /root/.hermes/config.yaml <<EOF
model:
  provider: ${HERMES_LLM_PROVIDER:-openai}
  default: ${HERMES_LLM_MODEL:-gpt-4o}

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

# Write API keys to Hermes .env
cat > /root/.hermes/.env <<EOF
OPENAI_API_KEY=${OPENAI_API_KEY:-}
EOF

# Link hermaquette skills into Hermes skills directory
if [ -d /hermes/skills/hermaquette ]; then
  ln -sfn /hermes/skills/hermaquette /root/.hermes/skills/hermaquette
  echo "[start] Linked hermaquette skills into Hermes"
fi

# Start Hermes gateway API server
echo "[start] Starting Hermes gateway on port 8642..."
API_SERVER_ENABLED=true \
API_SERVER_KEY="${HERMES_API_KEY:-hermaquette-local}" \
API_SERVER_PORT=8642 \
API_SERVER_HOST=127.0.0.1 \
hermes gateway &

# Wait for gateway to be ready (up to 30s)
READY=0
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8642/health > /dev/null 2>&1; then
    READY=1
    echo "[start] Hermes gateway ready after ${i}s"
    break
  fi
  sleep 1
done

if [ "$READY" -eq 0 ]; then
  echo "[start] WARNING: Hermes gateway did not start in 30s — worker will fall back to OpenAI directly"
fi

echo "[start] Starting Node.js worker..."
exec node worker.js
