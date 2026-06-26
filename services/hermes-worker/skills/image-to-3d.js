/**
 * image-to-3d skill
 *
 * Stage: image-to-3d
 *
 * Sculptor agent's geometry phase:
 *   1. Resolves concept image URL from payload or events table
 *   2. Budget-guards before calling fal.ai
 *   3. Calls generate3d() → glb_url + stl_url + geometry_hash
 *   4. Persists results to the spec table (glb_path, stl_path, provenance)
 *   5. Advances order state to 'geometry'
 *   6. Enqueues 'dfm-repair'
 */
import { nanoid } from 'nanoid'
import { generate3d, BudgetExhaustedError } from '../../../packages/image3d/adapter.js'
import { checkBudget } from '../../../packages/image3d/budget.js'
import { emitEvent, enqueueJob } from '../job-processor.js'

export async function imageTo3d(db, orderId, payload) {
  const { dry_run = process.env.DRY_RUN === 'true' } = payload
  let { image_url } = payload

  // ── 1. Resolve concept image URL ───────────────────────────────────────────
  if (!image_url) {
    const conceptEvent = db.prepare(`
      SELECT data FROM events
      WHERE order_id = ? AND stage = 'concept' AND event = 'completed'
      ORDER BY created_at DESC LIMIT 1
    `).get(orderId)

    // Also try 'images_ready' event (concept-images.js emits this)
    const imagesReadyEvent = !conceptEvent
      ? db.prepare(`
          SELECT data FROM events
          WHERE order_id = ? AND stage = 'concept' AND event = 'images_ready'
          ORDER BY created_at DESC LIMIT 1
        `).get(orderId)
      : null

    const eventRow = conceptEvent || imagesReadyEvent
    if (!eventRow) {
      throw new Error('No concept image found for order ' + orderId)
    }

    const data = JSON.parse(eventRow.data || '{}')
    // images_ready stores { images: [{url, ...}] }; completed stores { selected_url, ... }
    image_url = data.selected_url || data.image_url || data.concept_url
      || data.images?.[0]?.url
    if (!image_url) {
      throw new Error('No image_url in concept event data for order ' + orderId)
    }
  }

  emitEvent(db, orderId, 'sculptor', 'geometry_started',
    'Sculptor is generating 3D geometry', { agent: 'Sculptor' })

  // ── 2. Budget check ─────────────────────────────────────────────────────────
  const budget = checkBudget(0.80)
  if (!budget.allowed) {
    emitEvent(db, orderId, 'sculptor', 'geometry_failed',
      `Budget exhausted: $${budget.current.toFixed(2)} / $${budget.cap}`,
      { agent: 'Sculptor', budget })
    throw new Error(budget.reason)
  }

  // ── 3. Generate 3D geometry ─────────────────────────────────────────────────
  let result
  try {
    result = await generate3d(image_url, { orderId, dry_run })
  } catch (err) {
    if (err instanceof BudgetExhaustedError) {
      emitEvent(db, orderId, 'sculptor', 'geometry_failed',
        'Budget exhausted during 3D generation', { agent: 'Sculptor', error: err.message })
    } else {
      emitEvent(db, orderId, 'sculptor', 'geometry_failed',
        `3D generation failed: ${err.message}`, { agent: 'Sculptor', error: err.message })
    }
    throw err
  }

  // ── 4. Persist to spec table ────────────────────────────────────────────────
  // Schema: spec(id, order_id, stl_path, glb_path, provenance, ...)
  // We store URLs in path columns (AI pipeline uses URLs, not local paths).
  // geometry_hash and ai_model go into the provenance JSON.
  const existing = db.prepare('SELECT id, provenance FROM spec WHERE order_id = ? LIMIT 1').get(orderId)

  if (existing) {
    let provenance = {}
    try { provenance = JSON.parse(existing.provenance || '{}') } catch {}
    provenance.geometry_hash = result.geometry_hash
    provenance.ai_model = result.model_used
    provenance.image_url = image_url

    db.prepare(`
      UPDATE spec
      SET glb_path = ?, stl_path = ?, provenance = ?, updated_at = ?
      WHERE id = ?
    `).run(result.glb_url, result.stl_url || result.glb_url, JSON.stringify(provenance), Date.now(), existing.id)
  } else {
    const specId = nanoid()
    db.prepare(`
      INSERT INTO spec (id, order_id, glb_path, stl_path, provenance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      specId, orderId,
      result.glb_url,
      result.stl_url || result.glb_url,
      JSON.stringify({ geometry_hash: result.geometry_hash, ai_model: result.model_used, image_url }),
      Date.now(), Date.now()
    )
  }

  // ── 5. Advance order state ──────────────────────────────────────────────────
  db.prepare(`UPDATE orders SET state = 'geometry', updated_at = ? WHERE id = ?`)
    .run(Date.now(), orderId)

  emitEvent(db, orderId, 'sculptor', 'geometry_generated',
    `3D geometry ready (${result.model_used})`,
    {
      agent: 'Sculptor',
      geometry_hash: result.geometry_hash,
      model_used: result.model_used,
      glb_url: result.glb_url,
    })

  // ── 6. Enqueue DFM repair ───────────────────────────────────────────────────
  enqueueJob(db, orderId, 'dfm-repair', {
    stl_url: result.stl_url || result.glb_url,
    geometry_hash: result.geometry_hash,
    attempt: 1,
  })

  console.log(`[image-to-3d] order=${orderId} model=${result.model_used} hash=${result.geometry_hash}`)

  return result
}
