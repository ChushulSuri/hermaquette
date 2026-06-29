/**
 * Hunyuan3D v2 on fal.ai — primary image-to-3D provider.
 *
 * fal endpoint: "fal-ai/hunyuan3d/v2" (image-to-3D)
 * Pricing: ~$0.375/generation
 *
 * Geometry-frozen flow (KTD6):
 *   1. generateGeometry(imageUrl) → untextured OBJ/GLB mesh
 *   2. DFM-repair runs on that exact mesh
 *   3. applyTexture(meshUrl, referenceImageUrl) → textured GLB
 *      (if fal can't texture a caller-supplied mesh, fall back to generateTextured)
 */

const FAL_BASE = 'https://queue.fal.run'
const HUNYUAN_ENDPOINT = 'fal-ai/hunyuan3d/v2'

function getFalKey() {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY env var required')
  return key
}

async function falPost(endpoint, body) {
  const resp = await fetch(`${FAL_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${getFalKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text()
    const err = new Error(`fal.ai error ${resp.status}: ${text}`)
    err.status = resp.status
    throw err
  }
  return resp.json()
}

async function falPollResult(queueResp, maxWaitMs = 180_000) {
  // Use the status_url / response_url fal returns — for sub-pathed apps (e.g.
  // fal-ai/hunyuan3d/v2) the poll URL drops the variant, so reconstructing it
  // from the submit endpoint is wrong. Fall back to reconstruction if absent.
  const statusUrl = queueResp.status_url ||
    `${FAL_BASE}/${queueResp._endpoint}/requests/${queueResp.request_id}/status`
  const resultUrl = queueResp.response_url ||
    `${FAL_BASE}/${queueResp._endpoint}/requests/${queueResp.request_id}`
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const statusResp = await fetch(statusUrl, {
      headers: { 'Authorization': `Key ${getFalKey()}` }
    })
    if (!statusResp.ok) throw new Error(`fal status check failed: ${statusResp.status}`)
    const status = await statusResp.json()

    if (status.status === 'COMPLETED') {
      const resultResp = await fetch(resultUrl, {
        headers: { 'Authorization': `Key ${getFalKey()}` }
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

export async function generateGeometry(imageUrl, opts = {}) {
  // Generate untextured 3D mesh from image
  const queueResp = await falPost(HUNYUAN_ENDPOINT, {
    image_url: imageUrl,
    output_format: 'glb',
    do_remove_background: true,
    // no texture for geometry pass
    ...opts
  })
  const result = await falPollResult(queueResp)

  const meshUrl = result.model_mesh?.url || result.glb_url || result.mesh_url
  if (!meshUrl) throw new Error('No mesh URL in fal response: ' + JSON.stringify(result))

  return {
    mesh_url: meshUrl,
    cost_usd: 0.375, // Estimated — fal doesn't always return actual cost
    model: 'hunyuan3d-2',
    provider: 'hunyuan3d',
  }
}

export async function generateTextured(imageUrl, opts = {}) {
  // Single-shot: generate textured GLB directly (fallback when geometry-frozen isn't possible)
  const queueResp = await falPost(HUNYUAN_ENDPOINT, {
    image_url: imageUrl,
    output_format: 'glb',
    do_remove_background: true,
    ...opts
  })
  const result = await falPollResult(queueResp)

  const glbUrl = result.model_mesh?.url || result.glb_url
  const stlUrl = result.model_mesh?.stl_url || null
  if (!glbUrl) throw new Error('No GLB URL in fal response: ' + JSON.stringify(result))

  return {
    glb_url: glbUrl,
    stl_url: stlUrl,
    cost_usd: 0.375,
    model: 'hunyuan3d-2',
    provider: 'hunyuan3d',
  }
}
