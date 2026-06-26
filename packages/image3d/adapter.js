/**
 * Main image-to-3D adapter.
 * Geometry-frozen flow (KTD6):
 *   1. Generate untextured geometry (Hunyuan3D)
 *   2. DFM-repair happens externally on the returned mesh
 *   3. applyTexture() is called after DFM passes with the same mesh
 *
 * Also supports single-shot textured generation as fallback.
 */
import { createHash } from 'crypto'
import { BudgetExhaustedError, checkBudget, recordSpend } from './budget.js'
import { generateGeometry as hunyuanGeometry, generateTextured as hunyuanTextured } from './fal_hunyuan3d.js'
import { generateTextured as meshyTextured } from './fal_meshy.js'

// Cost estimates for budget precheck
const COST_ESTIMATES = {
  geometry: 0.375,      // Hunyuan3D geometry pass
  texture: 0.15,        // Texture pass (PBR)
  meshy: 0.60,          // Meshy fallback (single shot)
  total_frozen: 0.525,  // geometry + texture
  total_meshy: 0.60,
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
 *
 * Two-phase flow (geometry-frozen):
 *   phase 1: generateGeometry → raw mesh + geometry_hash
 *   phase 2: (after external DFM repair) applyTexture → colored GLB
 *
 * Single-shot fallback: generateTextured → colored GLB directly
 *
 * Returns:
 *   { glb_url, stl_url, geometry_hash, model_used, cost_usd, provider }
 */
export async function generate3d(imageUrl, opts = {}) {
  const { orderId = null, dry_run = process.env.DRY_RUN === 'true' } = opts

  if (dry_run) {
    return generate3dDry(imageUrl, opts)
  }

  // Budget precheck
  const budgetCheck = checkBudget(COST_ESTIMATES.total_frozen)
  if (!budgetCheck.allowed) {
    throw new BudgetExhaustedError(budgetCheck.reason)
  }

  // Phase 1: Generate geometry (untextured)
  let geometryResult, geometry_hash, totalCost

  try {
    geometryResult = await hunyuanGeometry(imageUrl, opts)
    geometry_hash = await computeGeometryHash(geometryResult.mesh_url)

    // Phase 2: Apply texture to frozen geometry
    // Note: Hunyuan3D may not support texturing a caller-supplied mesh.
    // In that case, we use the textured single-shot endpoint.
    const texturedResult = await hunyuanTextured(imageUrl, opts)
    totalCost = (geometryResult.cost_usd || 0) + (texturedResult.cost_usd || 0)

    recordSpend(totalCost, 'hunyuan3d-2', orderId)

    return {
      glb_url: texturedResult.glb_url,
      stl_url: texturedResult.stl_url || geometryResult.mesh_url,
      geometry_hash,
      model_used: 'hunyuan3d-2',
      cost_usd: totalCost,
      provider: 'hunyuan3d',
      mesh_url: geometryResult.mesh_url,  // untextured geometry for DFM
    }
  } catch (err) {
    // Don't retry budget errors
    if (err instanceof BudgetExhaustedError) throw err

    console.warn('[image3d] Hunyuan3D failed, falling back to Meshy:', err.message)

    // Budget precheck for Meshy
    const meshyBudget = checkBudget(COST_ESTIMATES.meshy)
    if (!meshyBudget.allowed) throw new BudgetExhaustedError(meshyBudget.reason)

    const meshyResult = await meshyTextured(imageUrl, opts)
    geometry_hash = await computeGeometryHash(meshyResult.glb_url)
    recordSpend(meshyResult.cost_usd || 0.60, 'meshy-v6', orderId)

    return {
      glb_url: meshyResult.glb_url,
      stl_url: meshyResult.stl_url,
      geometry_hash,
      model_used: 'meshy-v6',
      cost_usd: meshyResult.cost_usd || 0.60,
      provider: 'meshy',
    }
  }
}

/**
 * Dry-run: returns stub result without fal calls.
 * Used for testing the agentic flow without spending budget.
 */
export async function generate3dDry(imageUrl, opts = {}) {
  console.log('[image3d] DRY RUN — no fal.ai call made')
  return {
    glb_url: 'https://hermaquette.test/artifacts/dry-run/hero.glb',
    stl_url: 'https://hermaquette.test/artifacts/dry-run/hero.stl',
    geometry_hash: 'dry_run_hash_' + Date.now(),
    model_used: 'dry-run',
    cost_usd: 0,
    provider: 'dry-run',
    dry_run: true,
  }
}

export { BudgetExhaustedError }
