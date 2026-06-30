#!/usr/bin/env node
/**
 * dfm-repair skill script.
 * Reads stl_url from SQLite by orderId (no shell interpolation).
 * Usage: node repair.js <orderId> [attempt] [parentRunId]
 * Exit: 0 on PASS/FIXABLE, 1 on BLOCKED or fatal error
 */
import { createWriteStream, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { getDb, emitEvent, upsertSpec, writeDelegation } from '../../_shared/db.js'

const CAD_DFM_URL = process.env.CAD_DFM_URL || 'http://localhost:8000'

const orderId = process.argv[2]
const attempt = parseInt(process.argv[3] || '1')
const parentRunId = process.argv[4] || process.env.HERMES_RUN_ID || ''

if (!orderId) {
  console.error(JSON.stringify({ error: 'Usage: repair.js <orderId> [attempt] [parentRunId]' }))
  process.exit(1)
}

const db = getDb()

// Read stl_url from SQLite — never from argv (prevents shell injection)
const spec = db.prepare('SELECT * FROM spec WHERE order_id = ?').get(orderId)
if (!spec) {
  db.prepare("UPDATE orders SET state = 'error', updated_at = ? WHERE id = ?").run(Date.now(), orderId)
  console.error(JSON.stringify({ error: `Order ${orderId} has no spec record — run image-to-3d first` }))
  process.exit(1)
}

// Use spec.stl_path (written by image-to-3d on success, updated by dfm-repair on repair)
let stl_url = spec.stl_path

if (!stl_url) {
  db.prepare("UPDATE orders SET state = 'error', updated_at = ? WHERE id = ?").run(Date.now(), orderId)
  console.error(JSON.stringify({ error: `Order ${orderId} has no stl_path — run image-to-3d first` }))
  process.exit(1)
}

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

// Determine if stl_url is a local path or remote URL
const artifactsBase = process.env.ARTIFACTS_DIR || '/artifacts'
const tmpDir = join(artifactsBase, orderId, 'dfm')
try { mkdirSync(tmpDir, { recursive: true }) } catch {}
// Preserve the source extension — a Hunyuan GLB copied into a ".stl"-named file
// makes trimesh parse GLB bytes as STL → 0 faces. cad-dfm loads any of stl/glb/obj.
const srcExt = (stl_url.split('?')[0].match(/\.(glb|stl|obj|ply)$/i)?.[1] || 'glb').toLowerCase()
const tmpStl = join(tmpDir, `mesh_${orderId}_${attempt}.${srcExt}`)

if (stl_url.startsWith('/') || stl_url.startsWith('file://')) {
  // Local path — use directly (attempt 2 with repaired path from attempt 1)
  const localPath = stl_url.startsWith('file://') ? stl_url.slice(7) : stl_url
  try {
    const { copyFileSync } = await import('fs')
    copyFileSync(localPath, tmpStl)
  } catch (err) {
    db.prepare("UPDATE orders SET state = 'error', updated_at = ? WHERE id = ?").run(Date.now(), orderId)
    upsertSpec(db, orderId, { dfm_status: 'BLOCKED' })
    emitEvent(db, orderId, 'dfm-repair', 'dfm_blocked',
      `Cannot read local mesh: ${err.message}`,
      { attempt, error: err.message })
    console.log(JSON.stringify({
      status: 'BLOCKED',
      reason: `Cannot read local mesh: ${err.message}`,
      applied_repairs: [],
      mesh_checks: {},
    }))
    process.exit(1)
  }
} else {
  // Remote URL — download to artifacts
  try {
    await downloadMesh(stl_url, tmpStl)
  } catch (err) {
    db.prepare("UPDATE orders SET state = 'error', updated_at = ? WHERE id = ?").run(Date.now(), orderId)
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
}

let result
try {
  result = await runDfmRepair(tmpStl)
} catch (err) {
  db.prepare("UPDATE orders SET state = 'error', updated_at = ? WHERE id = ?").run(Date.now(), orderId)
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

// Call NVIDIA Nemotron directly for a customer-facing DFM explanation.
// (The local Hermes Nemotron gateway on :8643 isn't started, so hit the NVIDIA
// API directly with NEMOTRON_API_KEY against integrate.api.nvidia.com.)
let dfmExplanation = null
if (process.env.NEMOTRON_API_KEY) {
  try {
    const base = (process.env.NEMOTRON_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '')
    const nemotronResp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.NEMOTRON_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
        messages: [{ role: 'user', content: `In 2 short, friendly sentences, reassure a customer that their 3D-printed figurine passed manufacturability (DFM) checks and is ready to print. Be specific but non-technical. Checks: ${JSON.stringify(result.mesh_checks)}` }],
        max_tokens: 160,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (nemotronResp.ok) {
      const nem = await nemotronResp.json()
      dfmExplanation = nem.choices?.[0]?.message?.content?.trim() || null
    } else {
      console.warn('[dfm-repair] Nemotron HTTP', nemotronResp.status)
    }
  } catch (err) { console.warn('[dfm-repair] Nemotron call failed:', err.message) }
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
  upsertSpec(db, orderId, {
    dfm_status: 'FIXABLE',
    stl_path: result.repaired_stl_path || stl_url,
  })
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
  // BLOCKED — set error state so UI and web can react
  upsertSpec(db, orderId, { dfm_status: 'BLOCKED' })
  db.prepare("UPDATE orders SET state = 'error', updated_at = ? WHERE id = ?").run(Date.now(), orderId)
  emitEvent(db, orderId, 'dfm-repair', 'dfm_blocked',
    `Mesh cannot be repaired: ${result.reason || 'BLOCKED'}`,
    { attempt, mesh_checks: result.mesh_checks, dfm_explanation: dfmExplanation })

  writeDelegation(db, orderId, parentRunId, 'sculptor', 'completed')

  console.log(JSON.stringify({ status: 'ok', ...result, attempt, dfm_explanation: dfmExplanation }))
  process.exit(1)
}
