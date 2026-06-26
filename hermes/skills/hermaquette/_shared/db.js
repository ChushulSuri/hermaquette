#!/usr/bin/env node
import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'

const SQLITE_PATH = process.env.SQLITE_PATH || '/data/hermaquette.db'

let _db = null
export function getDb() {
  if (!_db) _db = new Database(SQLITE_PATH)
  return _db
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
