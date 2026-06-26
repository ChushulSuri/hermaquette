/**
 * dfm-gate skill
 *
 * Stage: dfm
 *
 * 1. Calls cad-dfm /dfm to check STL against Sculpteo PA12 tolerances
 * 2. Uses NVIDIA Nemotron to explain the result in plain English (KTD-designated step)
 * 3. On PASS: enqueues vendor-quote
 * 4. On FIXABLE: applies bounded auto-fix, re-runs geometry + DFM, records lesson in MEMORY.md
 * 5. On BLOCKED: marks order blocked, stops pipeline
 */
import { nanoid } from 'nanoid'
import fetch from 'node-fetch'
import fs from 'fs'
import { chat } from '../llm.js'
import { emitEvent } from '../job-processor.js'

const CAD_DFM_URL = process.env.CAD_DFM_URL || 'http://cad-dfm:8000'
// Explicit bind-mount path — same path build-geometry.js reads from
const MEMORY_PATH = '/hermes/MEMORY.md'

export async function dfmGate(db, orderId, payload) {
  const spec = db.prepare('SELECT * FROM spec WHERE order_id = ?').get(orderId)
  if (!spec) throw new Error(`Spec not found for order ${orderId}`)

  const stlPath = payload.stl_path || spec.stl_path
  if (!stlPath) throw new Error('No STL path available for DFM check')

  emitEvent(db, orderId, 'dfm', 'progress',
    'Hermes is running DFM validation against Sculpteo PA12 tolerances…', {})

  // ── 1. Run DFM check ────────────────────────────────────────────────────────
  const dfmRes = await fetch(`${CAD_DFM_URL}/dfm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: orderId,
      stl_path: stlPath,
      params: payload.params || {},
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!dfmRes.ok) {
    const body = await dfmRes.text()
    throw new Error(`DFM HTTP ${dfmRes.status}: ${body.slice(0, 300)}`)
  }

  const dfmResult = await dfmRes.json()
  console.log(`[dfm-gate] order=${orderId} status=${dfmResult.status}`)

  // ── 2. Nemotron explanation (NVIDIA designated step) ─────────────────────
  const explanation = await chat([
    {
      role: 'system',
      content: 'You are a manufacturing expert explaining a DFM result to a customer in plain, friendly English. Be concise: 2-3 sentences max. EXPLAIN ONLY — do not decide, override, or reinterpret the pass/fail status (it is already decided). Cite ONLY values present in the provided result; never invent measurements or numbers. Do not suggest geometry fixes the system did not request.',
    },
    {
      role: 'user',
      content: `DFM check result: ${JSON.stringify(dfmResult)}. Explain what this means for the customer and what happens next.`,
    },
  ], { step: 'dfm_explanation', max_tokens: 256, temperature: 0.2 })

  emitEvent(db, orderId, 'dfm', 'explanation',
    `Hermes (via NVIDIA Nemotron): ${explanation}`,
    { dfm_result: dfmResult, explanation })

  // ── 3. Branch on outcome ─────────────────────────────────────────────────

  if (dfmResult.status === 'PASS') {
    return await handlePass(db, orderId, spec, dfmResult, explanation)
  }

  if (dfmResult.status === 'FIXABLE') {
    return await handleFixable(db, orderId, spec, payload, dfmResult, explanation)
  }

  if (dfmResult.status === 'BLOCKED') {
    return handleBlocked(db, orderId, spec, dfmResult, explanation)
  }

  // Default: needs human review
  db.prepare(`UPDATE spec SET dfm_status = 'NEEDS_REVIEW', dfm_report = ?, updated_at = ? WHERE order_id = ?`)
    .run(JSON.stringify(dfmResult), Date.now(), orderId)
  db.prepare(`UPDATE orders SET state = 'needs_review', updated_at = ? WHERE id = ?`)
    .run(Date.now(), orderId)
  return { status: 'NEEDS_REVIEW', reason: dfmResult.reason, explanation }
}

// ── Outcome handlers ─────────────────────────────────────────────────────────

function handlePass(db, orderId, spec, dfmResult, explanation) {
  db.prepare(`UPDATE spec SET dfm_status = 'PASS', dfm_report = ?, updated_at = ? WHERE order_id = ?`)
    .run(JSON.stringify(dfmResult), Date.now(), orderId)
  db.prepare(`UPDATE orders SET state = 'manufacturable', updated_at = ? WHERE id = ?`)
    .run(Date.now(), orderId)

  const jobId = nanoid()
  db.prepare(`INSERT INTO jobs (id, order_id, stage, status, payload, queued_at) VALUES (?, ?, 'quote', 'queued', ?, ?)`)
    .run(jobId, orderId, JSON.stringify({ stl_path: spec.stl_path }), Date.now())

  console.log(`[dfm-gate] PASS order=${orderId} nextJob=${jobId}`)
  return { status: 'PASS', explanation, next_stage: 'quote' }
}

async function handleFixable(db, orderId, spec, payload, dfmResult, explanation) {
  emitEvent(db, orderId, 'dfm', 'fix_applied',
    `Hermes applied bounded auto-fix: ${dfmResult.fix_description}`, dfmResult)

  // Record lesson in MEMORY.md (KTD11 learning loop)
  recordDFMLesson(dfmResult)

  // Re-build geometry with fixed params
  const fixRes = await fetch(`${process.env.CAD_DFM_URL || 'http://cad-dfm:8000'}/geometry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: orderId,
      image_path: payload.image_path || '',
      params: {
        ...(payload.params || {}),
        ...(dfmResult.fixed_params || {}),
        use_cached_depth: true,
      },
    }),
    signal: AbortSignal.timeout(600_000),
  })

  if (!fixRes.ok) {
    const body = await fixRes.text()
    throw new Error(`Geometry rebuild after fix HTTP ${fixRes.status}: ${body.slice(0, 300)}`)
  }

  const fixedGeom = await fixRes.json()

  // Re-run DFM on fixed geometry
  const reDFMRes = await fetch(`${process.env.CAD_DFM_URL || 'http://cad-dfm:8000'}/dfm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: orderId,
      stl_path: fixedGeom.stl_path,
      params: dfmResult.fixed_params || {},
    }),
    signal: AbortSignal.timeout(120_000),
  })

  const reDFMResult = await reDFMRes.json()
  console.log(`[dfm-gate] post-fix DFM order=${orderId} status=${reDFMResult.status}`)

  db.prepare(`
    UPDATE spec
    SET dfm_status = ?, dfm_report = ?, stl_path = ?, glb_path = ?, updated_at = ?
    WHERE order_id = ?
  `).run(reDFMResult.status, JSON.stringify(reDFMResult), fixedGeom.stl_path, fixedGeom.glb_path, Date.now(), orderId)

  if (reDFMResult.status === 'PASS') {
    db.prepare(`UPDATE orders SET state = 'manufacturable', updated_at = ? WHERE id = ?`).run(Date.now(), orderId)
    const jobId = nanoid()
    db.prepare(`INSERT INTO jobs (id, order_id, stage, status, payload, queued_at) VALUES (?, ?, 'quote', 'queued', ?, ?)`)
      .run(jobId, orderId, JSON.stringify({ stl_path: fixedGeom.stl_path }), Date.now())
    return { status: 'PASS_AFTER_FIX', fix: dfmResult.fix_description, explanation, next_stage: 'quote' }
  }

  throw new Error(`DFM still failing after auto-fix: ${reDFMResult.status} — ${reDFMResult.reason}`)
}

function handleBlocked(db, orderId, _spec, dfmResult, explanation) {
  db.prepare(`UPDATE spec SET dfm_status = 'BLOCKED', dfm_report = ?, updated_at = ? WHERE order_id = ?`)
    .run(JSON.stringify(dfmResult), Date.now(), orderId)
  db.prepare(`UPDATE orders SET state = 'blocked', error_msg = ?, updated_at = ? WHERE id = ?`)
    .run(dfmResult.reason || 'DFM BLOCKED', Date.now(), orderId)
  console.warn(`[dfm-gate] BLOCKED order=${orderId} reason=${dfmResult.reason}`)
  return { status: 'BLOCKED', reason: dfmResult.reason, explanation }
}

// ── KTD11 learning loop ──────────────────────────────────────────────────────

function recordDFMLesson(dfmResult) {
  const lesson = [
    '',
    `## DFM Lesson — ${new Date().toISOString()}`,
    `**Failure class**: ${dfmResult.failure_class || 'thin_feature'}`,
    `**Details**: ${dfmResult.reason}`,
    `**Fix applied**: ${dfmResult.fix_description}`,
    `**Pre-emption rule**: ${dfmResult.lesson || 'Pre-thicken text features to ≥0.6mm on PA12 before DFM check'}`,
    '',
  ].join('\n')

  try {
    fs.appendFileSync(MEMORY_PATH, lesson, 'utf-8')
    console.log('[dfm-gate] Lesson recorded in MEMORY.md')
  } catch (err) {
    console.warn('[dfm-gate] Could not write to MEMORY.md:', err.message)
  }
}
