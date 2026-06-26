/**
 * concept-images skill
 *
 * Stage: concept
 *
 * Generates 3-4 concept images for the order using:
 *   1. Nano Banana Pro API (NANOBANANA_API_KEY) — primary
 *   2. OpenAI DALL-E 3 (OPENAI_API_KEY) — fallback
 *   3. Placeholder SVG — final fallback (never blocks the pipeline)
 *
 * Emits an 'images_ready' event with the image list.
 * Updates order state to 'concept' and awaits user selection.
 * Does NOT auto-enqueue the next stage — that happens when the user picks an image.
 */
import { nanoid } from 'nanoid'
import fetch from 'node-fetch'
import OpenAI from 'openai'
import { emitEvent } from '../job-processor.js'

export async function conceptImages(db, orderId, payload) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
  if (!order) throw new Error(`Order ${orderId} not found`)

  emitEvent(db, orderId, 'concept', 'progress',
    'Hermes is generating concept images…', {})

  const description = payload.description || order.description

  // Art-direction prompt: chunky full-3D figure style for fal.ai image-to-3D generation.
  // Single clean subject, no props/background, good depth cues for 3D reconstruction.
  const imagePrompt = `Chunky designer-toy / chibi-style 3D figure, front-facing, clean white \
background, single subject, no props, no shadow, studio product photography: ${description}. \
Bold shapes, clear silhouette, vibrant colors, suitable for 3D model generation.`

  const images = []

  // ── 1. Nano Banana Pro ──────────────────────────────────────────────────────
  const nanoBananaKey = process.env.NANOBANANA_API_KEY
  if (nanoBananaKey) {
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch('https://api.nanobanana.ai/v1/images/generate', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${nanoBananaKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: `${imagePrompt} (variation ${i + 1})`,
            model: 'nano-banana-pro',
          }),
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) {
          console.warn(`[concept] Nano Banana HTTP ${res.status} for variation ${i}`)
          continue
        }
        const data = await res.json()
        const url = data.url || data.data?.[0]?.url
        if (url) images.push({ id: nanoid(), url, source: 'nanobanana', variation: i + 1 })
      } catch (err) {
        console.warn(`[concept] Nano Banana variation ${i} failed:`, err.message)
      }
    }
  }

  // ── 2. DALL-E 3 fallback ────────────────────────────────────────────────────
  if (images.length < 3 && process.env.OPENAI_API_KEY) {
    try {
      console.log('[concept] Falling back to DALL-E 3')
      const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const dalleRes = await oai.images.generate({
        model: 'dall-e-3',
        prompt: imagePrompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      })
      const url = dalleRes.data[0]?.url
      if (url) images.push({ id: nanoid(), url, source: 'dalle3', variation: 1 })
    } catch (err) {
      console.warn('[concept] DALL-E 3 fallback failed:', err.message)
    }
  }

  // ── 3. Placeholder fallback (never blocks pipeline) ────────────────────────
  if (images.length === 0) {
    console.warn('[concept] No image provider available, using placeholder')
    const colors = ['1a0a3d/c0a060', '0d1f2d/a0c0ff', '1f0d2d/ff80c0']
    colors.forEach((c, i) => {
      images.push({
        id: nanoid(),
        url: `https://placehold.co/512x512/${c}?text=Concept+${i + 1}`,
        source: 'placeholder',
        variation: i + 1,
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

  // Store images in the events table for the UI to pick up via SSE
  db.prepare(`
    INSERT INTO events (order_id, stage, event, message, data, created_at)
    VALUES (?, 'concept', 'images_ready',
      'Hermes generated concept images — select a direction to continue',
      ?, ?)
  `).run(orderId, JSON.stringify({ images }), Date.now())

  console.log(`[concept] order=${orderId} images=${images.length} sources=${[...new Set(images.map(i => i.source))].join(',')}`)

  return { images, count: images.length, state: 'concept' }
}
