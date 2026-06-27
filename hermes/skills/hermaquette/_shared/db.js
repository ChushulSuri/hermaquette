#!/usr/bin/env node
import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import fs from 'fs'
import path from 'path'

const SQLITE_PATH = process.env.SQLITE_PATH || '/data/hermaquette.db'

let _db = null
export function getDb() {
  if (_db) return _db

  const db = new Database(SQLITE_PATH)

  // Performance and concurrency pragmas (match lib/db.ts)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -64000')
  db.pragma('temp_store = MEMORY')

  // Apply base schema (idempotent — uses IF NOT EXISTS)
  const schemaCandidates = [
    '/db/schema.sql',
    '/app/db/schema.sql',
    path.join(process.cwd(), 'db', 'schema.sql'),
  ]
  for (const candidate of schemaCandidates) {
    if (fs.existsSync(candidate)) {
      const schema = fs.readFileSync(candidate, 'utf-8')
      const schemaClean = schema
        .split('\n')
        .filter(line => !line.trimStart().startsWith('--'))
        .join('\n')
      const statements = schemaClean
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0)
      for (const stmt of statements) {
        try { db.exec(stmt) } catch { /* already applied */ }
      }
      break
    }
  }

  // Agentic cutover migration: add columns (mirrors lib/db.ts)
  const agenticColumns = [
    "ALTER TABLE orders ADD COLUMN run_id TEXT",
    "ALTER TABLE orders ADD COLUMN run1_response_id TEXT",
    "ALTER TABLE orders ADD COLUMN run2_run_id TEXT",
    "ALTER TABLE orders ADD COLUMN payment_confirmed_at INTEGER",
    "ALTER TABLE orders ADD COLUMN checkout_approved INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE spec ADD COLUMN approved_image_url TEXT",
  ]
  for (const col of agenticColumns) {
    try { db.exec(col) } catch { /* duplicate column — already applied */ }
  }

  _db = db
  return db
}

export function emitEvent(db, orderId, stage, event, message, data = {}) {
  db.prepare(`
    INSERT INTO events (order_id, stage, event, message, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orderId, stage, event, message, JSON.stringify(data), Date.now())
}

export function upsertSpec(db, orderId, fields) {
  const existing = db.prepare('SELECT id FROM spec WHERE order_id = ?').get(orderId)
  if (existing) {
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ')
    db.prepare(`UPDATE spec SET ${sets}, updated_at = ? WHERE order_id = ?`)
      .run(...Object.values(fields), Date.now(), orderId)
  } else {
    const id = nanoid()
    const cols = ['id', 'order_id', ...Object.keys(fields), 'created_at', 'updated_at'].join(', ')
    const placeholders = Array(2 + Object.keys(fields).length + 2).fill('?').join(', ')
    db.prepare(`INSERT INTO spec (${cols}) VALUES (${placeholders})`)
      .run(id, orderId, ...Object.values(fields), Date.now(), Date.now())
  }
}

export function writeLedger(db, orderId, fields) {
  const existing = db.prepare('SELECT id FROM ledger WHERE order_id = ?').get(orderId)
  if (existing) {
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ')
    db.prepare(`UPDATE ledger SET ${sets}, updated_at = ? WHERE order_id = ?`)
      .run(...Object.values(fields), Date.now(), orderId)
  } else {
    const id = nanoid()
    const cols = ['id', 'order_id', ...Object.keys(fields), 'created_at', 'updated_at'].join(', ')
    const placeholders = Array(2 + Object.keys(fields).length + 2).fill('?').join(', ')
    db.prepare(`INSERT INTO ledger (${cols}) VALUES (${placeholders})`)
      .run(id, orderId, ...Object.values(fields), Date.now(), Date.now())
  }
}

// Written by delegated children as proof-of-agency (N1). Primary observability signal.
export function writeDelegation(db, orderId, parentRunId, childRole, status) {
  const existing = db.prepare(
    'SELECT id FROM delegations WHERE order_id = ? AND child_role = ?'
  ).get(orderId, childRole)
  const now = Date.now()
  if (existing) {
    db.prepare(`UPDATE delegations SET status = ?, ${status === 'completed' ? 'completed_at = ?' : 'started_at = ?'} WHERE id = ?`)
      .run(status, now, existing.id)
  } else {
    db.prepare(`
      INSERT INTO delegations (id, order_id, parent_run_id, child_role, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(nanoid(), orderId, parentRunId || '', childRole, status, now)
  }
}
