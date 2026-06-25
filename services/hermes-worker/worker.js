import 'dotenv/config'
import Database from 'better-sqlite3'
import express from 'express'
import { processJob } from './job-processor.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.SQLITE_PATH || '/data/hermaquette.db'
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '2000')

// ── DB setup ────────────────────────────────────────────────────────────────

const dbDir = path.dirname(DB_PATH)
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Apply schema idempotently
const schemaPath = path.join(__dirname, '../../db/schema.sql')
if (fs.existsSync(schemaPath)) {
  db.exec(fs.readFileSync(schemaPath, 'utf-8'))
  console.log('[worker] Schema applied from', schemaPath)
} else {
  console.warn('[worker] Schema file not found at', schemaPath)
}

// ── Health server ────────────────────────────────────────────────────────────

const app = express()
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'hermes-worker', uptime: process.uptime() })
})
app.listen(3001, () => console.log('[worker] Health server on :3001'))

// ── Poll-and-process loop ────────────────────────────────────────────────────

// Track which job IDs are currently being processed in this process
// to avoid re-claiming a running job on the next poll cycle.
const inFlight = new Set()

async function pollAndProcess() {
  console.log('[worker] Starting poll loop (interval=%dms)', POLL_INTERVAL)

  while (true) {
    try {
      const job = claimOneJob()
      if (job && !inFlight.has(job.id)) {
        inFlight.add(job.id)
        // Process without awaiting so the loop can continue polling
        processJob(db, job)
          .catch(err => console.error('[worker] Unhandled job error:', err))
          .finally(() => inFlight.delete(job.id))
      }
    } catch (err) {
      console.error('[worker] Poll error:', err.message)
    }

    await sleep(POLL_INTERVAL)
  }
}

/**
 * Atomically claim one queued (or stale running) job.
 * Returns null when nothing is available.
 */
function claimOneJob() {
  return db.transaction(() => {
    const job = db.prepare(`
      SELECT * FROM jobs
      WHERE status IN ('queued', 'running')
      ORDER BY queued_at ASC
      LIMIT 1
    `).get()

    if (!job) return null

    db.prepare(`
      UPDATE jobs
      SET status = 'running',
          started_at = ?,
          attempts = attempts + 1
      WHERE id = ? AND status IN ('queued', 'running')
    `).run(Date.now(), job.id)

    return job
  })()
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

pollAndProcess().catch(err => {
  console.error('[worker] Fatal poll loop error:', err)
  process.exit(1)
})
