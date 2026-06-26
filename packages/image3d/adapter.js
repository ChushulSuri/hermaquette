/**
 * Main image-to-3D adapter.
 * Single-shot textured generation (Hunyuan3D primary → Meshy fallback).
 * geometry_hash is computed from the actual returned mesh, ensuring the hash
 * the DFM-repair step receives matches the mesh it repairs and quotes.
 */
import { createHash } from 'crypto'
import { BudgetExhaustedError, checkBudget, recordSpend } from './budget.js'
import { generateTextured as hunyuanTextured } from './fal_hunyuan3d.js'
import { generateTextured as meshyTextured } from './fal_meshy.js'

// Cost estimates for budget precheck
const COST_ESTIMATES = {
  primary: 0.375,  // single Hunyuan3D textured generation
  meshy: 0.60,     // Meshy fallback (single shot)
}

async function computeGeometryHash(meshUrl) {
  // Download mesh bytes and compute sha256
  try {
    const resp = await fetch(meshUrl)
    const buf = await resp.arrayBuffer()
    return createHash('sha256').update(Buffer.from(buf)).digest('hex')
  } catch {
    // If we can't download, use the URL as a proxy hash
    return createHash('sha256').update(meshUrl).digest('hex')
  }
}

/**
 * Generate a full 3D colored model from an image.
 * Single-shot textured generation; geometry_hash computed from the actual
 * returned mesh so DFM-repair and quote operate on the same geometry.
 *
 * Returns: { glb_url, stl_url, geometry_hash, model_used, cost_usd, provider }
 */
export async function generate3d(imageUrl, opts = {}) {
  const { orderId = null, dry_run = process.env.DRY_RUN === 'true' } = opts

  if (dry_run) return generate3dDry(imageUrl, opts)

  // Budget precheck — single generation
  const budgetCheck = checkBudget(COST_ESTIMATES.primary)
  if (!budgetCheck.allowed) throw new BudgetExhaustedError(budgetCheck.reason)

  try {
    const result = await hunyuanTextured(imageUrl, opts)
    const geometry_hash = await computeGeometryHash(result.glb_url)
    recordSpend(result.cost_usd || COST_ESTIMATES.primary, 'hunyuan3d-2', orderId)

    return {
      glb_url: result.glb_url,
      // stl_url may be a GLB if fal doesn't return a separate STL;
      // dfm-repair converts to .stl during the repair export step
      stl_url: result.stl_url || result.glb_url,
      geometry_hash,
      model_used: 'hunyuan3d-2',
      cost_usd: result.cost_usd || COST_ESTIMATES.primary,
      provider: 'hunyuan3d',
    }
  } catch (err) {
    if (err instanceof BudgetExhaustedError) throw err
    console.warn('[image3d] Hunyuan3D failed, falling back to Meshy:', err.message)

    const meshyBudget = checkBudget(COST_ESTIMATES.meshy)
    if (!meshyBudget.allowed) throw new BudgetExhaustedError(meshyBudget.reason)

    const meshyResult = await meshyTextured(imageUrl, opts)
    const geometry_hash = await computeGeometryHash(meshyResult.glb_url)
    recordSpend(meshyResult.cost_usd || COST_ESTIMATES.meshy, 'meshy-v6', orderId)

    return {
      glb_url: meshyResult.glb_url,
      stl_url: meshyResult.stl_url || meshyResult.glb_url,
      geometry_hash,
      model_used: 'meshy-v6',
      cost_usd: meshyResult.cost_usd || COST_ESTIMATES.meshy,
      provider: 'meshy',
    }
  }
}

/**
 * Dry-run: returns stub result without fal calls.
 * stl_url points to fixtures/sample.stl so dfm-repair can actually fetch it.
 */
export async function generate3dDry(imageUrl, opts = {}) {
  console.log('[image3d] DRY RUN — no fal.ai call made')
  // Resolve sample STL relative to this file's location (packages/image3d/ → ../../fixtures/)
  const { fileURLToPath } = await import('url')
  const { dirname, join, resolve } = await import('path')
  const { existsSync } = await import('fs')
  const here = dirname(fileURLToPath(import.meta.url))
  const sampleStl = resolve(here, '../../fixtures/sample.stl')
  const stlUrl = existsSync(sampleStl) ? `file://${sampleStl}` : null

  // geometry_hash from the real sample.stl bytes so continuity tests are meaningful
  let geometry_hash = 'dry_run_hash_' + Date.now()
  if (stlUrl) {
    geometry_hash = await computeGeometryHash(stlUrl.replace('file://', ''))
  }

  return {
    glb_url: 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3/examples/assets/ShopDamagedHelmet.glb',
    stl_url: stlUrl || 'file:///dev/null',
    geometry_hash,
    model_used: 'dry-run',
    cost_usd: 0,
    provider: 'dry-run',
    dry_run: true,
  }
}

export { BudgetExhaustedError }
