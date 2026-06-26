#!/usr/bin/env node
/**
 * dfm-repair skill script.
 * Downloads mesh from URL, runs /dfm/ai-mesh, returns structured result.
 */
import { createWriteStream, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'

const CAD_DFM_URL = process.env.CAD_DFM_URL || 'http://localhost:8000'

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

async function main() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk

  const { stl_url, geometry_hash, attempt = 1, order_id } = JSON.parse(input)

  if (!stl_url) {
    console.error(JSON.stringify({ error: 'stl_url required' }))
    process.exit(1)
  }

  // Download mesh to temp file
  const tmpDir = join(tmpdir(), 'hermaquette-dfm')
  try { mkdirSync(tmpDir, { recursive: true }) } catch {}
  const tmpStl = join(tmpDir, `mesh_${order_id || 'tmp'}_${Date.now()}.stl`)

  try {
    await downloadMesh(stl_url, tmpStl)
  } catch (err) {
    console.log(JSON.stringify({
      status: 'BLOCKED',
      reason: `Cannot fetch mesh: ${err.message}`,
      applied_repairs: [],
      mesh_checks: {},
    }))
    process.exit(0)
  }

  try {
    const result = await runDfmRepair(tmpStl)
    // Preserve geometry_hash from input (the hash covers the original mesh geometry)
    console.log(JSON.stringify({ ...result, geometry_hash, attempt }))
  } catch (err) {
    console.log(JSON.stringify({
      status: 'BLOCKED',
      reason: `DFM service unavailable: ${err.message}`,
      applied_repairs: [],
      mesh_checks: {},
      geometry_hash,
    }))
  }

  process.exit(0)
}

main()
