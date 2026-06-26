-- Hermaquette SQLite Schema
-- Apply once on first open; idempotent via IF NOT EXISTS

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── orders ───────────────────────────────────────────────────────────────────
-- Top-level order record. One per customer request.
CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  state       TEXT NOT NULL DEFAULT 'created',
    -- created | researching | generating | dfm_check | quoting | awaiting_payment
    -- | payment_confirmed | vendor_submitting | vendor_submitted | tracking
    -- | delivered | failed | cancelled
  description TEXT NOT NULL,
  material    TEXT NOT NULL DEFAULT 'pa12',
    -- pa12 | resin | tpu
  error_msg   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_orders_state ON orders(state);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- ── spec ─────────────────────────────────────────────────────────────────────
-- Technical specification for an order: geometry, DFM result, vendor assignment.
CREATE TABLE IF NOT EXISTS spec (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  file_format         TEXT NOT NULL DEFAULT 'stl',
    -- stl | step | obj | glb
  dimensions_mm       TEXT,
    -- JSON: {"x": 80, "y": 60, "z": 10}
  material            TEXT,
  process             TEXT,
    -- sls | mjf | fdm | sla | dlp
  dfm_status          TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    -- PASS | FAIL | FIXABLE | BLOCKED | NEEDS_REVIEW
  dfm_report          TEXT,
    -- JSON: full DFM check output from dfm.py
  vendor              TEXT,
    -- sculpteo | craftcloud | manual
  quote_status        TEXT NOT NULL DEFAULT 'pending',
    -- pending | quoted | accepted | rejected | expired
  stl_path            TEXT,
  glb_path            TEXT,
  ship_to_status      TEXT NOT NULL DEFAULT 'address_pending',
    -- address_pending | address_confirmed | shipped | delivered
  approved_image_id   TEXT,
  provenance          TEXT,
    -- JSON: {"depth_model": "depth-anything-v2", "geometry_script": "assemble.py", ...}
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_spec_order_id ON spec(order_id);
CREATE INDEX IF NOT EXISTS idx_spec_dfm_status ON spec(dfm_status);

-- ── ledger ───────────────────────────────────────────────────────────────────
-- Financial record: vendor cost, our fee, Stripe session.
CREATE TABLE IF NOT EXISTS ledger (
  id                          TEXT PRIMARY KEY,
  order_id                    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  vendor_cost_cents           INTEGER NOT NULL DEFAULT 0,
  service_fee_cents           INTEGER NOT NULL DEFAULT 0,
  revenue_cents               INTEGER NOT NULL DEFAULT 0,
    -- vendor_cost_cents + service_fee_cents
  gross_margin_pre_fees_cents INTEGER NOT NULL DEFAULT 0,
    -- service_fee_cents (before Stripe processing fees)
  lead_time_days              INTEGER,
  currency                    TEXT NOT NULL DEFAULT 'usd',
  quote_source                TEXT,
    -- api | scrape | manual
  stripe_session_id           TEXT,
  stripe_payment_status       TEXT,
    -- unpaid | paid | refunded | disputed
  created_at                  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_order_id ON ledger(order_id);
CREATE INDEX IF NOT EXISTS idx_ledger_stripe_session_id ON ledger(stripe_session_id);

-- ── vendor_order ─────────────────────────────────────────────────────────────
-- Vendor spend approval and Stripe Issuing card tracking.
CREATE TABLE IF NOT EXISTS vendor_order (
  id                     TEXT PRIMARY KEY,
  order_id               TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  vendor_cost_cents      INTEGER NOT NULL DEFAULT 0,
  spend_cap_cents        INTEGER NOT NULL DEFAULT 5000,
    -- hard cap before human approval required
  requires_human_approval INTEGER NOT NULL DEFAULT 1,
    -- 1 = blocked until approved_at is set
  approved_at            INTEGER,
  approved_by            TEXT,
    -- 'auto' | 'human:email@example.com'
  status                 TEXT NOT NULL DEFAULT 'pending',
    -- pending | approved | rejected | executing | executed | failed
  issuing_card_id        TEXT,
    -- Stripe Issuing card id used for vendor payment
  spend_path             TEXT,
    -- 'issuing_card' | 'manual' | 'api_direct'
  executed               INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_vendor_order_order_id ON vendor_order(order_id);
CREATE INDEX IF NOT EXISTS idx_vendor_order_status ON vendor_order(status);

-- ── qa ───────────────────────────────────────────────────────────────────────
-- Quality-assurance checks after delivery (photo/vision).
CREATE TABLE IF NOT EXISTS qa (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  photo_path      TEXT,
  measurement_mm  REAL,
  vision_result   TEXT,
    -- JSON: {"pass": true, "defects": [], "confidence": 0.97}
  draft_action    TEXT,
    -- 'approve' | 'flag_for_review' | 'request_reprint' | 'refund'
  draft_status    TEXT NOT NULL DEFAULT 'pending_approval',
    -- pending_approval | approved | rejected
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_qa_order_id ON qa(order_id);

-- ── jobs ─────────────────────────────────────────────────────────────────────
-- Background job queue consumed by hermes-worker.
CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage        TEXT NOT NULL,
    -- intake_research | build_geometry | dfm_gate | vendor_quote
    -- | ledger_payment | vendor_checkout | tracking_qa
  status       TEXT NOT NULL DEFAULT 'queued',
    -- queued | running | done | failed | cancelled
  attempts     INTEGER NOT NULL DEFAULT 0,
  payload      TEXT,
    -- JSON: stage-specific input params
  result       TEXT,
    -- JSON: stage-specific output
  error        TEXT,
  queued_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at   INTEGER,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_order_id ON jobs(order_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_stage_status ON jobs(stage, status);
CREATE INDEX IF NOT EXISTS idx_jobs_queued_at ON jobs(queued_at);

-- ── events ───────────────────────────────────────────────────────────────────
-- Append-only event log for real-time SSE streaming to the UI.
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage     TEXT,
  event     TEXT NOT NULL,
    -- job_queued | job_started | job_done | job_failed | dfm_pass | dfm_fail
    -- | quote_received | payment_confirmed | vendor_submitted | tracking_update
    -- | qa_result | error
  message   TEXT,
  data      TEXT,
    -- JSON: arbitrary stage-specific payload
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_events_order_id ON events(order_id);
CREATE INDEX IF NOT EXISTS idx_events_order_id_id ON events(order_id, id);
  -- used for SSE cursor queries: WHERE order_id = ? AND id > ?
