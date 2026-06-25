# Hermaquette — Coolify + DigitalOcean Deployment Runbook

> This is a complete, actionable guide for deploying Hermaquette on a DigitalOcean VPS using Coolify v4. Follow every step in order for a working demo deployment.

---

## 1. Prerequisites

Before you start, have the following ready:

- **DigitalOcean account** — [cloud.digitalocean.com](https://cloud.digitalocean.com)
- **GitHub or GitLab account** with the hermaquette repo pushed to it
- **Domain name** OR use a free Cloudflare Tunnel URL (no domain required for demo)
- **Cloudflare account** (free tier is fine) if using a tunnel
- All env vars from `.env.example` filled in, especially:
  - `OPENAI_API_KEY`
  - `NEMOTRON_API_KEY`
  - `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` (test keys)
  - `DEMO_TOKEN` (generate with `openssl rand -hex 32`)
  - `CLOUDFLARE_TUNNEL_TOKEN` (see Section 7)

---

## 2. DigitalOcean VPS Setup

### 2a. Create a Droplet

1. Go to **Droplets → Create Droplet**
2. **Image**: Ubuntu 22.04 LTS (x64)
3. **Size**: minimum **4GB RAM / 2 vCPUs** — cad-dfm needs RAM for PyTorch inference
   - Recommended: Basic plan, $24/mo (4GB RAM, 2 CPUs, 80GB SSD)
   - For production: $48/mo (8GB RAM, 4 CPUs)
4. **Region**: Choose closest to your audience
5. **SSH Key**: Add your public key (`~/.ssh/id_ed25519.pub` or generate a new one)
6. Click **Create Droplet**

### 2b. Configure Firewall

In DigitalOcean Networking → Firewalls, create a new firewall and attach it to your droplet:

| Type    | Protocol | Port Range | Source         |
|---------|----------|------------|----------------|
| Inbound | TCP      | 22         | Your IP only   |
| Inbound | TCP      | 80         | All IPv4/IPv6  |
| Inbound | TCP      | 443        | All IPv4/IPv6  |
| Inbound | TCP      | 8000       | Droplet only   |  ← restrict cad-dfm in production
| Inbound | TCP      | 3000       | All IPv4/IPv6  |  ← optional: restrict to VPC only behind tunnel

> In production, port 8000 (cad-dfm) should only be accessible within the Docker network. The firewall rule above blocks external access.

### 2c. Initial SSH Setup

```bash
ssh root@<droplet-ip>
# Update system
apt update && apt upgrade -y
# Create data directories (Coolify will also create these, but do it now)
mkdir -p /var/hermaquette/data /var/hermaquette/artifacts
chmod 777 /var/hermaquette/data /var/hermaquette/artifacts
```

---

## 3. Coolify Installation

### 3a. Install Coolify v4

SSH into your droplet and run the official installer:

```bash
ssh root@<droplet-ip>
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

This takes 2–5 minutes. It installs Docker, Coolify, and its supporting services.

### 3b. Access the Dashboard

Once installation completes, open your browser:

```
http://<droplet-ip>:8000
```

> Note: Coolify uses port 8000 by default. If you exposed 8000 in the firewall above, you can access this. After setup, lock port 8000 down again.

### 3c. Initial Admin Setup

1. You'll be prompted to create an admin account — use a strong password
2. Set **Coolify URL** to `http://<droplet-ip>:8000` (or your domain if you have one)
3. Skip the SSH key step if you're already logged in as root
4. Skip the server step — Coolify auto-configures localhost

---

## 4. Deploy from Git

### 4a. Add GitHub Source

1. In Coolify sidebar → **Sources → Add Source**
2. Select **GitHub App** (recommended) or **GitHub OAuth**
3. Follow the OAuth flow; install the GitHub App on your hermaquette repo
4. Coolify will now have permission to pull your repo

### 4b. Create Application

1. **Projects → New Project** → name it `hermaquette`
2. Inside the project → **Add Resource → Docker Compose**
3. Select your GitHub source and repository
4. Set **Branch**: `main`
5. Set **Docker Compose Location**: `docker-compose.yml` (root of repo)
6. Click **Save**

### 4c. Configure Build

In the application settings:
- **Build Pack**: Docker Compose (auto-detected)
- **Base Directory**: `/` (repo root)
- **Watch Paths**: leave default (all files)

---

## 5. Environment Variables in Coolify

In your Hermaquette application → **Environment Variables** tab, add ALL of the following:

### Secrets (mark as Secret in Coolify UI — they won't be shown in logs)

| Variable | Value |
|----------|-------|
| `OPENAI_API_KEY` | `sk-...` |
| `NEMOTRON_API_KEY` | `nvapi-...` |
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` |
| `DEMO_TOKEN` | `<output of openssl rand -hex 32>` |
| `CLOUDFLARE_TUNNEL_TOKEN` | `<from Section 7>` |
| `NANOBANANA_API_KEY` | `<your key>` |
| `SCULPTEO_API_KEY` | `<your key or leave empty>` |
| `AGENTMAIL_API_KEY` | `<your key or leave empty>` |

### Plain Variables

| Variable | Value |
|----------|-------|
| `NEMOTRON_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| `NEMOTRON_MODEL` | `nvidia/llama-3.1-nemotron-70b-instruct` |
| `LLM_PROVIDER` | `openai` |
| `STRIPE_ISSUING_ENABLED` | `false` |
| `SCULPTEO_API_URL` | `https://www.sculpteo.com/api/1` |
| `SQLITE_PATH` | `/data/hermaquette.db` |
| `ARTIFACTS_DIR` | `/artifacts` |
| `PUBLIC_BASE_URL` | `https://<your-cloudflare-tunnel-url>` |
| `HAPPY_PATH` | `off` |

> `PUBLIC_BASE_URL` must be updated after you get your Cloudflare Tunnel URL in Section 7.

---

## 6. Persistent Volumes

In Coolify → Application → **Volumes** tab, add two volume mappings:

| Host Path | Container Path | Service |
|-----------|----------------|---------|
| `/var/hermaquette/data` | `/data` | web, hermes-worker |
| `/var/hermaquette/artifacts` | `/artifacts` | web, hermes-worker, cad-dfm |

If Coolify doesn't expose volume editing directly via the UI for Docker Compose, set them in the `docker-compose.yml` directly using bind mounts:

```yaml
# In docker-compose.yml, replace named volumes with bind mounts for Coolify:
volumes:
  sqlite_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /var/hermaquette/data
  artifacts:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /var/hermaquette/artifacts
```

Ensure the host directories exist and are writable:

```bash
mkdir -p /var/hermaquette/data /var/hermaquette/artifacts
chmod 777 /var/hermaquette/data /var/hermaquette/artifacts
```

---

## 7. Cloudflare Tunnel Setup

### 7a. Named Tunnel (Recommended for Production)

1. Go to [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Zero Trust → Access → Tunnels**
2. Click **Create a Tunnel**
3. Name it `hermaquette-demo`
4. Copy the **tunnel token** (long string starting with `eyJ...`)
5. Set this as `CLOUDFLARE_TUNNEL_TOKEN` in Coolify

**Add Public Hostname:**
- Subdomain: `hermaquette` (or your choice)
- Domain: `yourdomain.com`
- Service: `http://web:3000`

The tunnel will route `https://hermaquette.yourdomain.com` → `http://web:3000` through the Docker network.

### 7b. Ephemeral Tunnel (No Account / Demo Speedrun)

For a zero-config demo URL with no Cloudflare account:

```bash
# On your droplet, run this in a screen/tmux session:
docker run cloudflare/cloudflared:latest tunnel --url http://<droplet-ip>:3000
```

Or if the web container is running:

```bash
docker run --network hermaquette_hermaquette_net cloudflare/cloudflared:latest \
  tunnel --url http://web:3000
```

This prints a free `*.trycloudflare.com` URL valid for the session. Use this URL as `PUBLIC_BASE_URL`.

> The `cloudflared` service in `docker-compose.yml` handles this automatically if `CLOUDFLARE_TUNNEL_TOKEN` is set. Leave it empty to skip the named tunnel.

---

## 8. Health Check & Smoke Test

After deployment, verify everything is running:

```bash
# SSH into your droplet
ssh root@<droplet-ip>

# Check all 4 containers are up
docker compose -f /var/coolify/applications/<app-id>/docker-compose.yml ps
# Or with the project name Coolify assigns:
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Health check each service
curl -s http://localhost:3000/api/health
# Expected: {"status":"ok","service":"hermaquette-web"}

curl -s http://localhost:8000/health
# Expected: {"status":"ok","service":"cad-dfm"}

curl -s http://localhost:3001/health
# Expected: {"status":"ok"}

# Check logs for errors
docker compose logs --tail=50 hermes-worker
docker compose logs --tail=50 cad-dfm
docker compose logs --tail=50 web
```

**Test the intake form end-to-end:**

```bash
# Create a test order (replace DEMO_TOKEN)
curl -s -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -H "x-demo-token: <your-DEMO_TOKEN>" \
  -d '{"description": "A small test cube 20mm on each side", "material": "pa12"}' | jq .
# Expected: {"id": "ord_xxxxxxxx"}
```

---

## 9. Rollback Procedure

### 9a. Via Coolify Dashboard (Easiest)

1. Go to Hermaquette application → **Deployments** tab
2. Find the last known-good deployment
3. Click **Redeploy** on that deployment row
4. Coolify rebuilds and restarts from the pinned commit SHA

### 9b. Manual Rollback

```bash
ssh root@<droplet-ip>
cd /var/coolify/applications/<app-id>  # or wherever Coolify checked out the repo

# Find the previous working commit
git log --oneline -10

# Check out the previous SHA
git checkout <previous-sha>

# Rebuild and restart
docker compose up -d --build

# Verify
docker compose ps
curl -s http://localhost:3000/api/health
```

### 9c. Database Safety

The SQLite database is on the host at `/var/hermaquette/data/hermaquette.db`. Before any risky migration:

```bash
cp /var/hermaquette/data/hermaquette.db \
   /var/hermaquette/data/hermaquette.db.bak-$(date +%Y%m%d-%H%M%S)
```

---

## 10. Demo Day Checklist

Run through this list 30 minutes before the demo:

- [ ] `HAPPY_PATH=off` — confirms full generative run, not pinned happy path
- [ ] `DEMO_TOKEN` is set and you know the value (you'll need it for curl tests)
- [ ] `PUBLIC_BASE_URL` matches the Cloudflare Tunnel URL (not localhost)
- [ ] `STRIPE_SECRET_KEY` is a `sk_test_...` key (never use live keys)
- [ ] All 4 containers healthy: `docker compose ps` shows `(healthy)` or `Up`
- [ ] Run a cold intake: paste a real description, confirm the order page loads
- [ ] Confirm the Cloudflare Tunnel URL is accessible from a mobile device (different network)
- [ ] Open a terminal with `docker compose logs -f hermes-worker` for live attribution during the demo
- [ ] Have `stripe listen --forward-to localhost:3000/api/webhooks/stripe` ready as a backup for payment redirects
- [ ] Browser tab pre-loaded at `<PUBLIC_BASE_URL>` with DevTools Console open
- [ ] Judge-facing README or slide ready with the tunnel URL

**Day-of quick health check (one command):**

```bash
curl -s http://localhost:3000/api/health && \
curl -s http://localhost:8000/health && \
echo "All services OK"
```

---

## Appendix: Common Issues

### cad-dfm container OOM crash

The PyTorch + build123d combo can use 2–3GB RAM at peak. If the cad-dfm container keeps restarting:

```bash
# Check memory
free -h
docker stats --no-stream

# Add swap if needed
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### better-sqlite3 fails to load in Docker

This is a native addon — it must be compiled inside the container. If you see `Error: Cannot find module '../build/Release/better_sqlite3.node'`:

1. Ensure the `Dockerfile` for `apps/web` and `services/hermes-worker` runs `npm ci` (not `npm install --production` which can skip devDependencies needed for binding compilation)
2. Check that `python3`, `make`, and `g++` are installed in the builder stage

### Stripe webhook redirect fails

For local/tunnel testing, run the Stripe CLI forwarder in a separate terminal:

```bash
stripe listen --forward-to http://localhost:3000/api/webhooks/stripe
```

The CLI prints a `whsec_...` signing secret — set this as `STRIPE_WEBHOOK_SECRET` in your `.env`.
