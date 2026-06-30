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

// Reference image (if uploaded) is used via fal's edit endpoint below, by URL.
// fal needs a reachable URL — our upload is already served at PUBLIC_BASE_URL/api/artifacts/...
const referenceImagePath = order.reference_image_path
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/artifacts'
let referenceImageUrl = null
if (referenceImagePath && PUBLIC_BASE_URL && referenceImagePath.startsWith(ARTIFACTS_DIR)) {
  referenceImageUrl = `${PUBLIC_BASE_URL}/api/artifacts${referenceImagePath.slice(ARTIFACTS_DIR.length)}`
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

// Art-direction prompt: a single clean subject on a plain background, with
// printability guidance so the generated image reconstructs into a clean mesh.
const basePrompt = `Collectible 3D-printable figurine, full body visible and uncropped, \
front-facing symmetrical standing pose, standing on a small round base, \
clean white background, single subject, no extra props, soft studio product lighting: ${description}. \
Bold clear silhouette, smooth printable surfaces, a single connected piece with no ultra-thin or \
fragile floating parts (no loose hair wisps or thin antennae), minimal unsupported overhangs, \
designed to 3D-print cleanly. No text, no logos, no watermark.`

// When a reference image is uploaded, keep the character recognizable.
const adherenceClause = referenceImageUrl
  ? ` Preserve the face, hairstyle and overall likeness of the character shown in the reference image and keep them clearly recognizable; invent only the outfit and body styling described above.`
  : ''

const imagePrompt = (revisionPrompt
  ? `${basePrompt} REVISED: ${revisionPrompt}`
  : basePrompt) + adherenceClause

const versionLabel = revisionPrompt ? `v${revisionN + 1}` : 'v1'

const images = []

// ── 1. FAL gpt-image-2 (Hermes native tool backend) ──────────────────────────
const FAL_BASE = 'https://queue.fal.run'
const GPT_IMAGE_ENDPOINT = 'fal-ai/gpt-image-2'
const falKey = process.env.FAL_KEY

async function falPost(endpoint, body) {
  // AbortSignal timeout so a slow/large request can never hang the run forever.
  const resp = await fetch(`${FAL_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`fal.ai error ${resp.status}: ${text}`)
  }
  return resp.json()
}

async function falPollResult(queueResp, endpoint, maxWaitMs = 120_000) {
  // The returned status_url is reliable. But for sub-pathed apps (.../edit-image)
  // fal returns a WRONG response_url (drops the variant → 404 "Path /edit-image
  // not found"). So try the returned URL first, then the sub-path reconstructed
  // from the submit endpoint.
  const statusUrl = queueResp.status_url ||
    `${FAL_BASE}/${endpoint}/requests/${queueResp.request_id}/status`
  const resultUrls = [...new Set([
    queueResp.response_url,
    `${FAL_BASE}/${endpoint}/requests/${queueResp.request_id}`,
  ].filter(Boolean))]
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const statusResp = await fetch(statusUrl, {
      headers: { 'Authorization': `Key ${falKey}` }, signal: AbortSignal.timeout(30_000),
    })
    if (!statusResp.ok) throw new Error(`fal status check failed: ${statusResp.status}`)
    const status = await statusResp.json()

    if (status.status === 'COMPLETED') {
      let lastStatus = 0
      for (const ru of resultUrls) {
        const r = await fetch(ru, {
          headers: { 'Authorization': `Key ${falKey}` }, signal: AbortSignal.timeout(30_000),
        })
        if (r.ok) return r.json()
        lastStatus = r.status
      }
      throw new Error(`fal result fetch failed: ${lastStatus}`)
    }
    if (status.status === 'FAILED') {
      throw new Error(`fal.ai request failed: ${JSON.stringify(status)}`)
    }
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error(`fal.ai request timed out after ${maxWaitMs}ms`)
}

// fal needs the reference as a URL, not inline base64 (computed near the top as
// referenceImageUrl). Use the gpt-image-2 EDIT endpoint (image-to-image) for it.
async function generateOne(i, useReference) {
  if (useReference && referenceImageUrl) {
    // Correct fal image-to-image endpoint (per docs). input_fidelity:high keeps
    // the result faithful to the uploaded reference.
    const editEndpoint = 'openai/gpt-image-2/edit'
    const queueResp = await falPost(editEndpoint, {
      prompt: `${imagePrompt} (variation ${i + 1})`,
      image_urls: [referenceImageUrl],
      quality: 'medium',
      input_fidelity: 'high',
    })
    return falPollResult(queueResp, editEndpoint)
  }
  const queueResp = await falPost(GPT_IMAGE_ENDPOINT, {
    prompt: `${imagePrompt} (variation ${i + 1})`,
    model: 'gpt-image-2',
    quality: 'medium',
  })
  return falPollResult(queueResp, GPT_IMAGE_ENDPOINT)
}

async function runVariations(useReference) {
  for (let i = 0; i < 4; i++) {
    try {
      const result = await generateOne(i, useReference)
      const url = result.images?.[0]?.url || result.data?.images?.[0]?.url
      if (url) images.push({ id: nanoid(), url, source: useReference ? 'gpt-image-2-edit' : 'gpt-image-2', variation: i + 1, revision_n: revisionN })
    } catch (err) {
      console.warn(`[concept] variation ${i} (${useReference ? 'edit' : 'text'}) failed:`, err.message)
    }
  }
}

if (falKey) {
  const useRef = !!referenceImageUrl
  if (useRef) console.warn(`[concept] reference image → edit endpoint: ${referenceImageUrl}`)
  await runVariations(useRef)
  // If the image-to-image path produced nothing, fall back to reliable text-only.
  if (images.length === 0 && useRef) {
    console.warn('[concept] reference-edit produced no images — falling back to text-only')
    await runVariations(false)
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
