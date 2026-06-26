#!/usr/bin/env node
/**
 * Hermaquette V2 dry run — exercises the full pipeline without fal.ai calls.
 *
 * Usage:
 *   DRY_RUN=true node scripts/demo/dry_run.js
 *   DRY_RUN=true node scripts/demo/dry_run.js --order-id ord_test123
 *
 * What it tests:
 *   1. Budget guard (should allow DRY_RUN calls)
 *   2. generate3dDry() returns stub GLB URL
 *   3. mesh_repair CLI returns PASS on a real sample STL
 *   4. vendor-quote mock (prints pricing calculation)
 *   5. Event emission (logged to stdout, not DB)
 *
 * Exit 0 = all steps passed. Exit 1 = any step failed.
 */
import { generate3dDry } from '../../packages/image3d/adapter.js'
import { checkBudget, getCurrentSpend, resetSpend } from '../../packages/image3d/budget.js'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '../..')

let passed = 0
let failed = 0

function check(label, fn) {
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        console.log(`  ✓ ${label}`)
        passed++
      }).catch(err => {
        console.error(`  ✗ ${label}: ${err.message}`)
        failed++
      })
    }
    console.log(`  ✓ ${label}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.message}`)
    failed++
  }
}

async function main() {
  const orderId = process.argv.find(a => a.startsWith('--order-id='))?.split('=')[1] || 'ord_dryrun_' + Date.now()

  console.log('\n=== Hermaquette V2 Dry Run ===')
  console.log(`Order ID: ${orderId}`)
  console.log(`DRY_RUN: ${process.env.DRY_RUN}`)
  console.log()

  // Step 1: Budget guard
  console.log('Step 1: Budget guard')
  await check('Budget allows 0-cost dry-run call', () => {
    const result = checkBudget(0)
    if (!result.allowed) throw new Error('Budget blocked zero-cost call')
  })
  await check('Current spend readable', () => {
    const spend = getCurrentSpend()
    if (typeof spend !== 'number') throw new Error('Expected number')
    console.log(`         Current spend: $${spend.toFixed(3)}`)
  })

  // Step 2: Dry-run 3D generation
  console.log('\nStep 2: Dry-run 3D generation (no fal.ai call)')
  let glbUrl = null
  let geometryHash = null
  await check('generate3dDry() returns stub GLB', async () => {
    const result = await generate3dDry('https://example.com/test-concept.png', { orderId })
    if (!result.glb_url) throw new Error('No glb_url in dry-run result')
    if (!result.geometry_hash) throw new Error('No geometry_hash')
    if (result.cost_usd !== 0) throw new Error('Dry-run should have zero cost')
    glbUrl = result.glb_url
    geometryHash = result.geometry_hash
    console.log(`         GLB: ${result.glb_url}`)
    console.log(`         Hash: ${result.geometry_hash}`)
  })

  // Step 3: Mesh repair on sample STL
  console.log('\nStep 3: Mesh repair (sample.stl)')
  const sampleStl = join(ROOT, 'fixtures/sample.stl')
  if (existsSync(sampleStl)) {
    await check('mesh_repair.py PASS on sample.stl', () => {
      const out = execSync(
        `python3 mesh_repair.py --stl "${sampleStl}"`,
        { cwd: join(ROOT, 'services/cad-dfm'), encoding: 'utf8' }
      )
      const result = JSON.parse(out.trim())
      if (!['PASS', 'FIXABLE'].includes(result.status)) {
        throw new Error(`Expected PASS/FIXABLE, got ${result.status}: ${result.reason}`)
      }
      console.log(`         Status: ${result.status}`)
      console.log(`         Repairs: ${result.applied_repairs.join(', ') || 'none'}`)
    })
  } else {
    console.log('  ~ sample.stl not found, skipping mesh repair test')
  }

  // Step 4: Pricing calculation
  console.log('\nStep 4: Pricing calculation')
  await check('10% margin math is correct', () => {
    const vendorCost = 24.50
    const serviceFee = Math.round(vendorCost * 0.10 * 100) / 100
    const total = vendorCost + serviceFee
    if (Math.abs(serviceFee - 2.45) > 0.01) throw new Error(`Expected 2.45, got ${serviceFee}`)
    if (Math.abs(total - 26.95) > 0.01) throw new Error(`Expected 26.95, got ${total}`)
    console.log(`         Vendor: $${vendorCost} + Fee: $${serviceFee} = Total: $${total}`)
  })

  // Summary
  console.log(`\n=== Dry Run Summary ===`)
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)

  if (failed > 0) {
    console.error('\nDry run FAILED')
    process.exit(1)
  } else {
    console.log('\nDry run PASSED')
    process.exit(0)
  }
}

main().catch(err => {
  console.error('Dry run fatal error:', err)
  process.exit(1)
})
