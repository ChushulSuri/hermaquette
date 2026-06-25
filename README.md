# Hermaquette

> Other agents move bits. Hermaquette ships atoms.

**Hermaquette** is a Hermes-operated micro-manufacturing pipeline. You describe a non-electronic object; Hermes researches references, generates concept images, builds manufacturable geometry, validates it locally, quotes it from a real vendor, takes a governed Stripe payment, and manages the vendor checkout — end-to-end, with a visible DFM fail/fix loop and a learning memory that improves with each run.

## The demo loop (90–110 seconds)

1. **Describe** the Nous Girl Hermes Relief Plaque
2. **Hermes researches** provenance + rights framing
3. **Concept images** generated (Nano Banana Pro / DALL-E 3)
4. **3D geometry built**: depth map → relief slab → `manifold3d` union onto parametric plaque
5. **DFM fails** (text too thin for PA12) → Hermes applies one bounded auto-fix → **DFM PASS** ← visible on camera
6. **Hermes records a lesson** in MEMORY.md for future runs
7. **Sculpteo quote** + 10% service fee → customer price shown
8. **Stripe Checkout** (TEST MODE) → payment confirmed server-side
9. **Governed vendor gate**: Stripe Issuing virtual card issued with spend cap (never charged)
10. **Generic object** runs next — lesson from step 6 pre-thickens text → **first-run DFM PASS** (learning loop payoff)

## Sponsor tech coverage

### Nous / Hermes
- All 8 pipeline stages are **Hermes custom skills** (`hermes/skills/hermaquette/*/SKILL.md`)
- The worker is a **private Hermes agent** consuming jobs and emitting Hermes-attributed progress events
- **DFM self-improvement loop**: each failure appends a lesson to `hermes/MEMORY.md`; later runs consult the memory and pre-empt known failures
- GPT (ChatGPT OAuth) is the **primary orchestration LLM** for all reasoning steps

### NVIDIA Nemotron
- The **on-camera DFM-error explanation** is the designated Nemotron step: Hermes uses `nvidia/llama-3.1-nemotron-70b-instruct` via `integrate.api.nvidia.com/v1` to explain each DFM failure in plain language
- Configured via Hermes's native `hermes model` provider routing — Nemotron is a first-class LLM provider, not a bolt-on
- Graceful fallback to GPT if Nemotron is unreachable (order still progresses)

### Stripe
- **Customer leg**: hosted Stripe Checkout (test mode), session created via the **Stripe Agent Toolkit** with a restricted `rk_test_*` key; confirmed server-side by `sessions.retrieve` (no webhooks, idempotent)
- **Vendor leg**: on human approval, Hermes issues a **test-mode Stripe Issuing virtual card** with `spending_limits` = spend cap and merchant-category scope — the actual agentic-commerce governance primitive. Card is **never charged** (no real Sculpteo purchase)
- Fallback: if Issuing test access is unavailable, the governed approval record is written to SQLite with the same gate semantics

## Honesty box

| Claim | Reality |
|-------|---------|
| Stripe payments | TEST MODE — use card `4242 4242 4242 4242` |
| Gross margin | Pre-fees only — Stripe fees and ops costs not deducted |
| Vendor quote | Live Sculpteo API (or recorded fallback labelled as such) |
| Rights | One-off personal gift · Not for resale · No affiliation with Nous/Hermes claimed |
| Issuing card | Issued in test mode, never charged, never used for a live purchase |

## Quick start

```bash
cp .env.example .env
# Fill in: OPENAI_API_KEY, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, DEMO_TOKEN
# Optional: NEMOTRON_API_KEY, SCULPTEO_API_KEY, NANOBANANA_API_KEY

docker compose up --build
# Web app: http://localhost:3000
# cad-dfm API: http://localhost:8000/health
# Worker health: http://localhost:3001/health
```

For the Cloudflare Tunnel demo URL, see `docs/runbook-coolify-digitalocean.md`.

### Demo dry-run (verify before recording)

```bash
# Full pipeline dry-run (no real payment, no vendor execute)
node scripts/demo/dry_run.js --all

# Cold-run truth-test (HAPPY_PATH=off, cache cleared)
HAPPY_PATH=off node scripts/demo/dry_run.js --all

# Recording mode (pinned known-good params)
HAPPY_PATH=on node scripts/demo/dry_run.js --all
```

## Architecture

```
Customer (browser)
  → Next.js web/api  (App Router, port 3000)
    → SQLite (orders, spec, ledger, vendor_order, events, jobs)
    → Hermes worker (job loop, skills, port 3001)
        → GPT (primary LLM: research, concepts, QA vision)
        → NVIDIA Nemotron (DFM explanation — NVIDIA beat)
        → Nano Banana Pro (concept images)
        → cad-dfm service (port 8000):
            → Depth Anything V2 → relief slab → build123d frame → manifold3d union
            → trimesh DFM gate (PA12 constants)
        → Sculpteo VendorQuoteAdapter (live API → browser → manual)
        → Stripe (Checkout session + Issuing virtual card)
```

## Structure

```
hermaquette/
├── apps/web/                 # Next.js App Router (intake, order page, Stripe)
├── services/hermes-worker/   # Job loop: consume orders, run skills, emit events
├── services/cad-dfm/         # Python: depth map, relief, DFM gate (FastAPI)
├── hermes/skills/hermaquette/ # 8 Hermes SKILL.md definitions
├── hermes/MEMORY.md           # DFM learning store (appended by dfm-gate skill)
├── packages/vendor/           # VendorQuoteAdapter + spend adapter
├── packages/llm/              # Provider shim: GPT primary, Nemotron designated
├── db/schema.sql              # SQLite schema (7 tables)
├── docker-compose.yml         # 4 services + 2 volumes
├── scripts/demo/              # Dry-run harness, cache, happy-path toggle
└── docs/
    ├── runbook-coolify-digitalocean.md
    └── submission.md
```

## Deployment

See `docs/runbook-coolify-digitalocean.md` for the full Coolify + DigitalOcean VPS deployment guide.

---

*Built for the Hermes Hackathon 2026. Deadline: EOD 2026-06-30.*
