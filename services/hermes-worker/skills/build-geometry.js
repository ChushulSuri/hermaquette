/**
 * build-geometry skill
 *
 * Stage: geometry
 *
 * Calls the cad-dfm Python service to:
 *   depth_map → relief slab → parametric frame → boolean union → STL + GLB
 *
 * Expects payload.approved_image_path (set by the web API when user picks a concept image).
 * On success: updates spec with STL/GLB paths, enqueues DFM gate.
 */
import { nanoid } from 'nanoid'
import fetch from 'node-fetch'
import { emitEvent } from '../job-processor.js'

const CAD_DFM_URL = process.env.CAD_DFM_URL || 'http://cad-dfm:8000'
const TIMEOUT_MS = parseInt(process.env.GEOMETRY_TIMEOUT_MS || '600000')

export async function buildGeometry(db, orderId, payload) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
  const spec  = db.prepare('SELECT * FROM spec  WHERE order_id = ?').get(orderId)

  if (!order) throw new Error(`Order ${orderId} not found`)

  const imagePath = payload.approved_image_path
  if (!imagePath) throw new Error('No approved_image_path in payload — user must select a concept image first')

  emitEvent(db, orderId, 'geometry', 'progress',
    'Hermes is building relief geometry: depth map → relief slab → parametric frame → union…', {})

  const material = spec?.material || order.material || 'pa12'
  const happyPath = process.env.HAPPY_PATH === 'on'

  const geomPayload = {
    order_id: orderId,
    image_path: imagePath,
    params: {
      material,
      happy_path: happyPath,
      base_thickness_mm: 3.0,
      relief_depth_mm: 1.5,
      // text_depth deliberately thin to trigger DFM fail in demo mode
      text_depth_mm: happyPath ? 0.6 : 0.3,
      engrave_depth_mm: happyPath ? 0.6 : 0.5,
      plaque_width_mm: 100,
      plaque_height_mm: 80,
    },
  }

  console.log(`[build-geometry] order=${orderId} POST ${CAD_DFM_URL}/geometry happy_path=${happyPath}`)

  const res = await fetch(`${CAD_DFM_URL}/geometry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geomPayload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Geometry build HTTP ${res.status}: ${body.slice(0, 300)}`)
  }

  const result = await res.json()

  // Update spec
  db.prepare(`
    UPDATE spec
    SET stl_path = ?, glb_path = ?, dimensions_mm = ?, dfm_status = 'NEEDS_REVIEW', updated_at = ?
    WHERE order_id = ?
  `).run(result.stl_path, result.glb_path, JSON.stringify(result.dimensions_mm || {}), Date.now(), orderId)

  db.prepare(`UPDATE orders SET state = 'preview', updated_at = ? WHERE id = ?`)
    .run(Date.now(), orderId)

  // Enqueue DFM gate
  const jobId = nanoid()
  db.prepare(`
    INSERT INTO jobs (id, order_id, stage, status, payload, queued_at)
    VALUES (?, ?, 'dfm', 'queued', ?, ?)
  `).run(jobId, orderId, JSON.stringify({
    stl_path: result.stl_path,
    image_path: imagePath,
    params: { ...geomPayload.params, ...result.params },
  }), Date.now())

  console.log(`[build-geometry] order=${orderId} stl=${result.stl_path} nextJob=${jobId}`)

  return { ...result, state: 'preview', next_stage: 'dfm' }
}
