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
import { readFileSync } from 'fs'
import fetch from 'node-fetch'
import { emitEvent } from '../job-processor.js'

const HERMES_MEMORY_PATH = '/hermes/MEMORY.md'

// Return true only if dfm-gate has appended a runtime DFM lesson (the `## DFM Lesson —`
// heading it writes after each FIXABLE cycle). Deliberately does NOT match the pre-seeded
// documentation section ("## Initial Lessons") so the hero fail/fix beat fires on every
// cold run until Hermes actually learns it.
function hasLearnedThinTextLesson() {
  try {
    const memory = readFileSync(HERMES_MEMORY_PATH, 'utf-8')
    // Only count lessons written at runtime by dfm-gate.js (ISO-date heading)
    return /^## DFM Lesson — \d{4}-\d{2}-\d{2}/m.test(memory)
  } catch {
    return false
  }
}

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
  // B2: check MEMORY.md first — if Hermes logged a thin-text lesson from a prior run,
  // pre-thicken so this object passes DFM first-try (the honest cross-object learning beat).
  const learnedPreThicken = !happyPath && hasLearnedThinTextLesson()
  const useThickText = happyPath || learnedPreThicken

  if (learnedPreThicken) {
    emitEvent(db, orderId, 'geometry', 'progress',
      'Hermes applied a lesson from memory: pre-thickening text features to pass DFM first-try', {
        learned: true, lesson_source: 'MEMORY.md',
      })
  }

  const geomPayload = {
    order_id: orderId,
    image_path: imagePath,
    params: {
      material,
      happy_path: happyPath,
      base_thickness_mm: 3.0,
      relief_depth_mm: 1.5,
      // text_depth: thin (0.3mm) triggers DFM fail on first run; learned pre-thicken
      // or HAPPY_PATH=on uses 0.6mm to pass first-try on subsequent objects.
      text_depth_mm: useThickText ? 0.6 : 0.3,
      // engrave_depth_mm is the param frame.py actually extrudes — set thin (0.3) so
      // dfm.py:76 triggers the engrave_too_shallow check and the re-built STL genuinely differs.
      engrave_depth_mm: useThickText ? 0.6 : 0.3,
      plaque_text: order.description.split(' ').slice(0, 3).join(' ').toUpperCase().slice(0, 14),
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

  // Non-manifold union → BLOCKED: set order state and stop pipeline gracefully
  if (result.status === 'BLOCKED') {
    db.prepare(`UPDATE orders SET state = 'blocked', error_msg = ?, updated_at = ? WHERE id = ?`)
      .run(result.reason || 'Geometry union produced non-manifold mesh', Date.now(), orderId)
    emitEvent(db, orderId, 'geometry', 'blocked', `Hermes: ${result.reason}`, result)
    return { status: 'BLOCKED', reason: result.reason }
  }

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
