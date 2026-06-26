#!/usr/bin/env node
/**
 * dfm-repair skill script.
 * Downloads mesh from URL, runs /dfm/ai-mesh, returns structured result.
 *
 * Usage: node repair.js <orderId> <stl_url> [attempt] [parentRunId]
 * Exit: 0 on PASS/FIXABLE, 1 on BLOCKED or fatal error
 */
import { createWriteStream, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { getDb, emitEvent, upsertSpec, writeDelegation } from '../_shared/db.js'

const CAD_DFM_URL = process.env.CAD_DFM_URL || 'http://localhost:8000'

const orderId = process.argv[2]
const stl_url = process.argv[3]
const attempt = parseInt(process.argv[4] || '1')
const parentRunId = process.argv[5] || process.env.HERMES_RUN_ID || ''

if (!orderId || !stl_url) {
  console.error(JSON.stringify({ error: 'Usage: repair.js <orderId> <stl_url> [attempt] [parentRunId]' }))
  process.exit(1)
}

const db = getDb()

async function downloadMesh(url, destPath) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to download mesh: ${resp.status}`)
  const writer = createWriteStream(destPath)
  await pipeline(resp.body, writer)
}

async function runDfmRepair(stlPath) {
  const resp = await fetch(`${CAD_DFM_URL}/dfm/ai-mesh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stl_path: stlPath }),
  })
  if (!resp.ok) {
    throw new Error(`DFM service error: ${resp.status}`)
  }
  return resp.json()
}

// Download mesh to temp file
const tmpDir = join(tmpdir(), 'hermaquette-dfm')
try { mkdirSync(tmpDir, { recursive: true }) } catch {}
const tmpStl = join(tmpDir, `mesh_${orderId}_${Date.now()}.stl`)

try {
  await downloadMesh(stl_url, tmpStl)
} catch (err) {
  upsertSpec(db, orderId, { dfm_status: 'BLOCKED' })
  emitEvent(db, orderId, 'dfm-repair', 'dfm_blocked',
    `Cannot fetch mesh for DFM repair: ${err.message}`,
    { attempt, error: err.message })
  console.log(JSON.stringify({
    status: 'BLOCKED',
    reason: `Cannot fetch mesh: ${err.message}`,
    applied_repairs: [],
    mesh_checks: {},
  }))
  process.exit(1)
}

let result
try {
  result = await runDfmRepair(tmpStl)
} catch (err) {
  upsertSpec(db, orderId, { dfm_status: 'BLOCKED' })
  emitEvent(db, orderId, 'dfm-repair', 'dfm_blocked',
    `DFM service unavailable: ${err.message}`,
    { attempt, error: err.message })
  console.log(JSON.stringify({
    status: 'BLOCKED',
    reason: `DFM service unavailable: ${err.message}`,
    applied_repairs: [],
    mesh_checks: {},
  }))
  process.exit(1)
}

// Optionally call Nemotron for a customer-facing DFM explanation
let dfmExplanation = null
if (process.env.NEMOTRON_API_KEY) {
  try {
    const nemotronResp = await fetch('http://127.0.0.1:8643/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.HERMES_API_KEY || 'hermaquette-local'}`,
      },
      body: JSON.stringify({
        model: process.env.NEMOTRON_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct',
        messages: [{ role: 'user', content: `Explain this DFM result in 2 sentences for a customer: ${JSON.stringify(result.mesh_checks)}` }],
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (nemotronResp.ok) {
      const nem = await nemotronResp.json()
      dfmExplanation = nem.choices?.[0]?.message?.content
    }
  } catch (err) { /* explanation optional */ }
}

// Persist result based on DFM status
if (result.status === 'PASS') {
  upsertSpec(db, orderId, {
    dfm_status: 'PASS',
    stl_path: result.repaired_stl_path || stl_url,
  })
  emitEvent(db, orderId, 'dfm-repair', 'dfm_pass',
    'Mesh passes DFM — proceeding to quote',
    { attempt, applied_repairs: result.applied_repairs, mesh_checks: result.mesh_checks, dfm_explanation: dfmExplanation })

  // If this is the final DFM step (PASS = done), mark sculptor delegation completed
  writeDelegation(db, orderId, parentRunId, 'sculptor', 'completed')

  console.log(JSON.stringify({ status: 'ok', ...result, attempt, dfm_explanation: dfmExplanation }))
  process.exit(0)

} else if (result.status === 'FIXABLE') {
  upsertSpec(db, orderId, { dfm_status: 'FIXABLE' })
  emitEvent(db, orderId, 'dfm-repair', 'dfm_fixable',
    `Mesh is fixable — attempt ${attempt}`,
    { attempt, applied_repairs: result.applied_repairs, mesh_checks: result.mesh_checks, dfm_explanation: dfmExplanation })

  // If this was the last attempt (attempt 2), mark sculptor completed (failed path)
  if (attempt >= 2) {
    writeDelegation(db, orderId, parentRunId, 'sculptor', 'completed')
  }

  console.log(JSON.stringify({ status: 'ok', ...result, attempt, dfm_explanation: dfmExplanation }))
  process.exit(0)

} else {
  // BLOCKED
  upsertSpec(db, orderId, { dfm_status: 'BLOCKED' })
  emitEvent(db, orderId, 'dfm-repair', 'dfm_blocked',
    `Mesh cannot be repaired: ${result.reason || 'BLOCKED'}`,
    { attempt, mesh_checks: result.mesh_checks, dfm_explanation: dfmExplanation })

  writeDelegation(db, orderId, parentRunId, 'sculptor', 'completed')

  console.log(JSON.stringify({ status: 'ok', ...result, attempt, dfm_explanation: dfmExplanation }))
  process.exit(1)
}
