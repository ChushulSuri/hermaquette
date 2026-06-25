import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  const dbPath = process.env.SQLITE_PATH
  if (!dbPath) {
    throw new Error('[hermaquette/db] SQLITE_PATH env var is not set')
  }

  // Ensure the directory exists
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const db = new Database(dbPath)

  // Performance and safety pragmas
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -64000') // 64MB page cache
  db.pragma('temp_store = MEMORY')

  // Apply schema on first open (idempotent — uses IF NOT EXISTS)
  const schemaPath = path.join(process.cwd(), '..', '..', 'db', 'schema.sql')
  // Try multiple candidate paths for schema (dev vs Docker)
  const schemaCandidates = [
    schemaPath,
    path.join(process.cwd(), 'db', 'schema.sql'),
    '/app/db/schema.sql',
    path.join(__dirname, '..', '..', '..', 'db', 'schema.sql'),
  ]

  let schemaApplied = false
  for (const candidate of schemaCandidates) {
    if (fs.existsSync(candidate)) {
      const schema = fs.readFileSync(candidate, 'utf-8')
      // Run each statement separately (better-sqlite3 doesn't support multi-statement exec)
      const statements = schema
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'))
      for (const stmt of statements) {
        try {
          db.exec(stmt)
        } catch {
          // Ignore PRAGMA errors that are already applied
        }
      }
      schemaApplied = true
      break
    }
  }

  if (!schemaApplied) {
    console.warn('[hermaquette/db] schema.sql not found — skipping schema init')
  }

  _db = db
  return db
}

/**
 * Validate the demo token from an incoming request.
 * Returns true if the token matches DEMO_TOKEN env var.
 * Returns false otherwise (caller should respond 401).
 */
export function requireDemoToken(req: NextRequest | Request): boolean {
  const demoToken = process.env.DEMO_TOKEN
  if (!demoToken) return true // If no token set, allow all (dev mode)

  const headerToken = req.headers.get('x-demo-token')
  return headerToken === demoToken
}
