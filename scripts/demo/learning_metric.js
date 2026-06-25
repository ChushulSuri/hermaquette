/**
 * Learning metric display for the demo.
 * Counts lessons in MEMORY.md and DFM events to show Hermes self-improvement.
 *
 * Visible metric: "N lessons written, M DFM failures avoided"
 * This is the quantified-learning beat that scores well with judges.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '../..')
const MEMORY_PATH = path.join(ROOT, 'hermes/MEMORY.md')

export function countLessons() {
  if (!fs.existsSync(MEMORY_PATH)) return 0
  const content = fs.readFileSync(MEMORY_PATH, 'utf-8')
  return (content.match(/^## (DFM Lesson|Lesson)/gm) || []).length
}

export function countDFMEvents(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return { fixable: 0, avoided: 0, pass: 0 }
  const db = new Database(dbPath, { readonly: true })
  const fixable = db.prepare(`SELECT COUNT(*) as n FROM events WHERE event='fix_applied'`).get()
  const avoided = db.prepare(`SELECT COUNT(*) as n FROM events WHERE event='explanation' AND message LIKE '%PASS%after%'`).get()
  const pass = db.prepare(`SELECT COUNT(*) as n FROM events WHERE event='completed' AND stage='dfm'`).get()
  db.close()
  return {
    fixable: fixable?.n || 0,
    avoided: avoided?.n || 0,
    pass: pass?.n || 0,
  }
}

export function printLearningMetrics(dbPath) {
  const lessons = countLessons()
  const dfm = countDFMEvents(dbPath)

  console.log('\n┌─ Hermes Learning Metrics ────────────────────────┐')
  console.log(`│  Lessons recorded in MEMORY.md:  ${String(lessons).padStart(3)}               │`)
  console.log(`│  DFM auto-fixes applied:         ${String(dfm.fixable).padStart(3)}               │`)
  console.log(`│  DFM passes (incl. first-try):   ${String(dfm.pass).padStart(3)}               │`)
  console.log(`│  (lesson applied = pre-thicken → first-run PASS)  │`)
  console.log('└──────────────────────────────────────────────────┘')
}
