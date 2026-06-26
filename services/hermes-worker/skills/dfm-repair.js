/**
 * dfm-repair skill
 *
 * Stage: dfm-repair
 *
 * Sculptor agent's bounded DFM iteration loop:
 *   Attempt 1: download STL → POST /dfm/ai-mesh → PASS → enqueue 'quote'
 *   Attempt 2: (if FIXABLE after attempt 1) re-run on repaired STL
 *   After MAX_REPAIR_ATTEMPTS with no PASS → mark order state 'dfm_blocked'
 *
 * The DFM service runs dfm.py::run_dfm_ai_mesh() which wraps mesh_repair.repair_mesh().
 */
import { createWriteStream, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { emitEvent, enqueueJob } from '../job-processor.js'

const CAD_DFM_URL = process.env.CAD_DFM_URL || 'http://localhost:8000'
const MAX_REPAIR_ATTEMPTS = 2

async function downloadMesh(url, destPath) {
  // Support file:// URLs (repaired mesh from a prior attempt on shared FS)
  if (url.startsWith('file://')) {
    const srcPath = url.slice('file://'.length)
    const { createReadStream } = await import('fs')
    const writer = createWriteStream(destPath)
    await pipeline(createReadStream(srcPath), writer)
    return
  }

  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!resp.ok) throw new Error(`Cannot download mesh: HTTP ${resp.status} ${url}`)
  const writer = createWriteStream(destPath)
  await pipeline(resp.body, writer)
}

async function callDfmRepair(stlPath) {
  const resp = await fetch(`${CAD_DFM_URL}/dfm/ai-mesh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stl_path: stlPath }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`DFM service error: HTTP ${resp.status} — ${body.slice(0, 300)}`)
  }
  return resp.json()
}

export async function dfmRepair(db, orderId, payload) {
  const { stl_url, geometry_hash, attempt = 1 } = payload

  emitEvent(db, orderId, 'dfm', 'repair_started',
    `DFM repair attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}`,
    { agent: 'Sculptor', attempt })

  db.prepare(`UPDATE orders SET state = 'dfm', updated_at = ? WHERE id = ?`)
    .run(Date.now(), orderId)

  // ── Download mesh to temp file ───────────────────────────────────────────────
  const tmpDir = join(tmpdir(), 'hermaquette-dfm')
  try { mkdirSync(tmpDir, { recursive: true }) } catch {}
  const tmpStl = join(tmpDir, `${orderId}_${attempt}_${Date.now()}.stl`)

  try {
    await downloadMesh(stl_url, tmpStl)
  } catch (err) {
    emitEvent(db, orderId, 'dfm', 'repair_blocked',
      `Cannot fetch mesh for DFM: ${err.message}`,
      { agent: 'Sculptor', error: err.message, attempt })

    if (attempt >= MAX_REPAIR_ATTEMPTS) {
      db.prepare(`UPDATE orders SET state = 'dfm_blocked', error_msg = ?, updated_at = ? WHERE id = ?`)
        .run('Mesh download failed', Date.now(), orderId)
    }
    throw err
  }

  // ── Call DFM repair service ─────────────────────────────────────────────────
  let dfmResult
  try {
    dfmResult = await callDfmRepair(tmpStl)
  } catch (err) {
    // DFM service unavailable — emit and rethrow; job-processor will mark error
    emitEvent(db, orderId, 'dfm', 'repair_blocked',
      `DFM service unavailable: ${err.message}`,
      { agent: 'Sculptor', error: err.message, attempt })
    throw err
  }

  console.log(`[dfm-repair] order=${orderId} attempt=${attempt} status=${dfmResult.status}`)

  // ── PASS ────────────────────────────────────────────────────────────────────
  if (dfmResult.status === 'PASS') {
    emitEvent(db, orderId, 'dfm', 'repair_applied',
      'Mesh passes DFM — proceeding to quote',
      {
        agent: 'Sculptor',
        geometry_hash,
        repairs: dfmResult.applied_repairs,
        mesh_checks: dfmResult.mesh_checks,
      })

    db.prepare(`UPDATE orders SET state = 'manufacturable', updated_at = ? WHERE id = ?`)
      .run(Date.now(), orderId)

    // Update spec dfm_status
    db.prepare(`UPDATE spec SET dfm_status = 'PASS', dfm_report = ?, updated_at = ? WHERE order_id = ?`)
      .run(JSON.stringify(dfmResult), Date.now(), orderId)

    enqueueJob(db, orderId, 'quote', {
      stl_url: dfmResult.repaired_stl_path
        ? `file://${dfmResult.repaired_stl_path}`
        : stl_url,
      geometry_hash,
    })

    return dfmResult
  }

  // ── FIXABLE — retry if attempts remain ─────────────────────────────────────
  if (dfmResult.status === 'FIXABLE' && attempt < MAX_REPAIR_ATTEMPTS) {
    emitEvent(db, orderId, 'dfm', 'repair_retry',
      `DFM fixable — retrying (attempt ${attempt + 1}/${MAX_REPAIR_ATTEMPTS})`,
      {
        agent: 'Sculptor',
        reason: dfmResult.reason,
        repairs: dfmResult.applied_repairs,
        attempt,
      })

    // Use repaired mesh from this attempt if available; otherwise same URL
    const nextStlUrl = dfmResult.repaired_stl_path
      ? `file://${dfmResult.repaired_stl_path}`
      : stl_url

    enqueueJob(db, orderId, 'dfm-repair', {
      stl_url: nextStlUrl,
      geometry_hash,
      attempt: attempt + 1,
    })

    return dfmResult
  }

  // ── BLOCKED or FIXABLE after max attempts ───────────────────────────────────
  const reason = dfmResult.reason || (dfmResult.status === 'FIXABLE'
    ? `Still fixable after ${attempt} attempt(s) — manual intervention required`
    : 'DFM blocked')

  emitEvent(db, orderId, 'dfm', 'repair_blocked',
    `DFM blocked after ${attempt} attempt(s): ${reason}`,
    { agent: 'Sculptor', reason, attempt, status: dfmResult.status })

  db.prepare(`UPDATE orders SET state = 'dfm_blocked', error_msg = ?, updated_at = ? WHERE id = ?`)
    .run(reason, Date.now(), orderId)

  db.prepare(`UPDATE spec SET dfm_status = ?, dfm_report = ?, updated_at = ? WHERE order_id = ?`)
    .run(dfmResult.status, JSON.stringify(dfmResult), Date.now(), orderId)

  return dfmResult
}
