#!/usr/bin/env node
/**
 * concept-images skill script
 *
 * Generates 3-4 concept images for an order using:
 *   1. FAL gpt-image-2 via queue.fal.run (FAL_KEY) — primary
 *   2. Placeholder SVG — fallback (never blocks pipeline)
 *
 * Reads description from SQLite (no shell interpolation).
 * Usage: node run.js <orderId>
 * Output: JSON to stdout
 * Exit: 0 on success, 1 on fatal error
 */
import { nanoid } from 'nanoid'
import { getDb, emitEvent } from '../../_shared/db.js'

const orderId = process.argv[2]

if (!orderId) {
  console.error(JSON.stringify({ error: 'Usage: run.js <orderId>' }))
  process.exit(1)
}

const db = getDb()
const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
if (!order) {
  console.error(JSON.stringify({ error: `Order ${orderId} not found` }))
  process.exit(1)
}

// Read description from SQLite — never from argv (prevents shell injection)
const description = order.description
if (!description) {
  console.error(JSON.stringify({ error: `Order ${orderId} has no description` }))
  process.exit(1)
}

emitEvent(db, orderId, 'concept', 'progress',
  'Hermes is generating concept images…', {})

// Check for reference image
const referenceImagePath = order.reference_image_path
let referenceImageBase64 = null
if (referenceImagePath) {
  try {
    const fs = await import('fs')
    if (fs.existsSync(referenceImagePath)) {
      const buf = fs.readFileSync(referenceImagePath)
      referenceImageBase64 = buf.toString('base64')
      console.warn(`[concept] Using reference image: ${referenceImagePath}`)
    }
  } catch (err) {
    console.warn(`[concept] Failed to read reference image:`, err.message)
  }
}

// Check for revision prompt (from revise API)
const revisionN = order.revision_n || 0
let revisionPrompt = ''
if (revisionN > 0) {
  const revisionEvent = db.prepare(
    "SELECT data FROM events WHERE order_id = ? AND event = 'revision_requested' ORDER BY created_at DESC LIMIT 1"
  ).get(orderId)
  if (revisionEvent?.data) {
    try {
      const parsed = JSON.parse(revisionEvent.data)
      revisionPrompt = parsed.prompt || ''
    } catch { /* */ }
  }
}

// Art-direction prompt: chunky full-3D figure style for fal.ai image-to-3D generation.
// Single clean subject, no props/background, good depth cues for 3D reconstruction.
const basePrompt = `Chunky designer-toy / chibi-style 3D figure, full body visible and uncropped, \
front-facing symmetrical standing pose, thick rounded limbs, arms slightly separated from the body, \
clean white background, single subject, no props, no shadow, studio product photography: ${description}. \
Bold shapes, clear silhouette, vibrant colors, suitable for 3D model generation. \
NOT a coin, NOT a relief, NOT a plaque, NOT a depth map; no text, no logos, no watermark.`

const imagePrompt = revisionPrompt
  ? `${basePrompt} REVISED: ${revisionPrompt}`
  : basePrompt

const versionLabel = revisionPrompt ? `v${revisionN + 1}` : 'v1'

const images = []

// ── 1. FAL gpt-image-2 (Hermes native tool backend) ──────────────────────────
const FAL_BASE = 'https://queue.fal.run'
const GPT_IMAGE_ENDPOINT = 'fal-ai/gpt-image-2'
const falKey = process.env.FAL_KEY

async function falPost(endpoint, body) {
  const resp = await fetch(`${FAL_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`fal.ai error ${resp.status}: ${text}`)
  }
  return resp.json()
}

async function falPollResult(endpoint, requestId, maxWaitMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const statusResp = await fetch(`${FAL_BASE}/${endpoint}/requests/${requestId}/status`, {
      headers: { 'Authorization': `Key ${falKey}` }
    })
    if (!statusResp.ok) throw new Error(`fal status check failed: ${statusResp.status}`)
    const status = await statusResp.json()

    if (status.status === 'COMPLETED') {
      const resultResp = await fetch(`${FAL_BASE}/${endpoint}/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${falKey}` }
      })
      if (!resultResp.ok) throw new Error(`fal result fetch failed: ${resultResp.status}`)
      return resultResp.json()
    }
    if (status.status === 'FAILED') {
      throw new Error(`fal.ai request failed: ${JSON.stringify(status)}`)
    }
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error(`fal.ai request timed out after ${maxWaitMs}ms`)
}

if (falKey) {
  for (let i = 0; i < 4; i++) {
    try {
      const payload = {
        prompt: `${imagePrompt} (variation ${i + 1})`,
        model: 'gpt-image-2',
        quality: 'medium',
      }
      if (referenceImageBase64) {
        payload.image = `data:image/jpeg;base64,${referenceImageBase64}`
      }
      const queueResp = await falPost(GPT_IMAGE_ENDPOINT, payload)
      const result = await falPollResult(GPT_IMAGE_ENDPOINT, queueResp.request_id)
      const url = result.images?.[0]?.url || result.data?.images?.[0]?.url
      if (url) images.push({ id: nanoid(), url, source: 'gpt-image-2', variation: i + 1, revision_n: revisionN })
    } catch (err) {
      console.warn(`[concept] gpt-image-2 variation ${i} failed:`, err.message)
    }
  }
}

// ── 2. Placeholder fallback (never blocks pipeline) ────────────────────────
if (images.length === 0) {
  console.warn('[concept] No image provider available, using placeholder')
  const colors = ['1a0a3d/c0a060', '0d1f2d/a0c0ff', '1f0d2d/ff80c0']
  colors.forEach((c, i) => {
    images.push({
      id: nanoid(),
      url: `https://placehold.co/512x512/${c}?text=Concept+${i + 1}`,
      source: 'placeholder',
      variation: i + 1,
      revision_n: revisionN,
    })
  })
}

// Ensure at least 3 variations (pad with copies if needed)
while (images.length < 3) {
  images.push({ ...images[0], id: nanoid() })
}

// ── Persist & notify ────────────────────────────────────────────────────────
db.prepare(`UPDATE orders SET state = 'concept', updated_at = ? WHERE id = ?`)
  .run(Date.now(), orderId)

emitEvent(db, orderId, 'concept', 'images_ready',
  revisionPrompt ? `Hermes generated revised concept images (${versionLabel}) — select a direction to continue` : 'Hermes generated concept images — select a direction to continue',
  { images, revision_n: revisionN })

console.warn(`[concept] order=${orderId} images=${images.length} sources=${[...new Set(images.map(i => i.source))].join(',')}`)

console.log(JSON.stringify({ status: 'ok', images, count: images.length }))
process.exit(0)
