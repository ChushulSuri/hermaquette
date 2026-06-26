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
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { emitEvent, enqueueJob } from '../job-processor.js'
import { chat } from '../llm.js'

// NVIDIA Nemotron designated step: explain the deterministic DFM result in plain
// English (explanation only — never decides pass/fail). Routed to Nemotron via
// step:'dfm_explanation'. Failure is non-fatal; the pipeline does not depend on it.
async function explainDfm(db, orderId, dfmResult) {
  try {
    const explanation = await chat([
      {
        role: 'system',
        content: 'You are a manufacturing expert explaining a 3D-print DFM result to a customer in plain, friendly English. Be concise: 2-3 sentences. EXPLAIN ONLY — never decide or change the status. Cite ONLY values present in the result; never invent measurements.',
      },
      {
        role: 'user',
        content: `DFM repair result for an AI-generated figure: ${JSON.stringify(dfmResult)}. Explain what this means for the customer and what happens next.`,
      },
    ], { step: 'dfm_explanation', max_tokens: 256, temperature: 0.2 })
    emitEvent(db, orderId, 'dfm', 'explanation',
      `Hermes (via NVIDIA Nemotron): ${explanation}`,
      { agent: 'Sculptor', explanation, status: dfmResult.status })
  } catch (err) {
    console.warn('[dfm-repair] Nemotron explanation unavailable:', err.message)
  }
}

const CAD_DFM_URL = process.env.CAD_DFM_URL || 'http://localhost:8000'
// Worker and cad-dfm both mount /artifacts — use this for staging meshes so
// the absolute path the worker sends to cad-dfm is valid inside cad-dfm too.
// /tmp is NOT shared between containers.
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/artifacts'
const MAX_REPAIR_ATTEMPTS = 2

async function downloadMesh(url, destPath) {
  // Support file:// URLs (repaired mesh already on the shared /artifacts volume)
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

  // ── Download mesh to /artifacts/<orderId>/dfm/ (shared with cad-dfm) ────────
  const dfmDir = join(ARTIFACTS_DIR, orderId, 'dfm')
  try { mkdirSync(dfmDir, { recursive: true }) } catch {}
  const tmpStl = join(dfmDir, `attempt_${attempt}.stl`)

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

  // NVIDIA Nemotron designated step — explain the (already-decided) DFM result.
  await explainDfm(db, orderId, dfmResult)

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

    // Persist repaired STL path + DFM report so viewer and quote use the same mesh
    const repairedStlUrl = dfmResult.repaired_stl_path
      ? `file://${dfmResult.repaired_stl_path}`
      : stl_url
    db.prepare(`UPDATE spec SET dfm_status = 'PASS', stl_path = ?, dfm_report = ?, updated_at = ? WHERE order_id = ?`)
      .run(dfmResult.repaired_stl_path || null, JSON.stringify(dfmResult), Date.now(), orderId)

    enqueueJob(db, orderId, 'quote', {
      stl_url: repairedStlUrl,
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
