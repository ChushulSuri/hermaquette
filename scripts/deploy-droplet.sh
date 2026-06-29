#!/usr/bin/env bash
# Hermaquette — Manual build + deploy script
# Builds web + hermes-agent images, recreates containers, reconnects proxy.
# Run from the repo root on the target host.
set -euo pipefail

echo "=== Hermaquette deploy — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# ── 1. Build images ─────────────────────────────────────────────────────────
echo "[1/5] Building web image..."
docker build -t hermaquette-web:latest -f apps/web/Dockerfile .

echo "[1/5] Building hermes-agent image..."
docker build -t hermaquette-hermes-agent:latest -f services/hermes-agent/Dockerfile .

# ── 2. Stop containers (preserves volumes) ──────────────────────────────────
echo "[2/5] Stopping containers..."
docker compose stop web hermes-agent

# ── 3. Recreate containers (no rebuild — use the images we just built) ──────
echo "[3/5] Recreating containers..."
docker compose up -d --no-build --force-recreate web hermes-agent

# ── 4. Reconnect to Coolify proxy network ───────────────────────────────────
echo "[4/5] Reconnecting to coolify network..."
if docker network inspect coolify >/dev/null 2>&1; then
  docker network connect coolify hermaquette-web-1 2>/dev/null || true
  docker network connect coolify hermaquette-hermes-agent-1 2>/dev/null || true
  echo "   Reconnected to coolify network"
else
  echo "   No coolify network found — skipping"
fi

# ── 5. Health check ─────────────────────────────────────────────────────────
echo "[5/5] Waiting for health checks..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
    echo "   Web: healthy"
    break
  fi
  sleep 2
done

for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8642/health >/dev/null 2>&1; then
    echo "   Hermes: healthy"
    break
  fi
  sleep 2
done

echo ""
echo "=== Deploy complete ==="
echo "Verify: docker exec hermaquette-hermes-agent-1 cat /root/.hermes/config.yaml"
echo "  Expected: provider=openai-codex, reasoning_effort=high, approvals=off, no mcp_servers"
