/**
 * Meshy v6 on fal.ai — fallback image-to-3D provider.
 * fal endpoint: "fal-ai/meshy-ai/image-to-3d"
 * Pricing: ~$0.40-0.80/generation
 */

const FAL_BASE = 'https://queue.fal.run'
const MESHY_ENDPOINT = 'fal-ai/meshy-ai/image-to-3d'

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
    const err = new Error(`fal.ai meshy error ${resp.status}: ${text}`)
    err.status = resp.status
    throw err
  }
  return resp.json()
}

async function falPollResult(endpoint, requestId, maxWaitMs = 180_000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const statusResp = await fetch(`${FAL_BASE}/${endpoint}/requests/${requestId}/status`, {
      headers: { 'Authorization': `Key ${getFalKey()}` }
    })
    if (!statusResp.ok) throw new Error(`meshy status check failed: ${statusResp.status}`)
    const status = await statusResp.json()

    if (status.status === 'COMPLETED') {
      const resultResp = await fetch(`${FAL_BASE}/${endpoint}/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${getFalKey()}` }
      })
      if (!resultResp.ok) throw new Error(`meshy result fetch failed: ${resultResp.status}`)
      return resultResp.json()
    }
    if (status.status === 'FAILED') {
      throw new Error(`meshy request failed: ${JSON.stringify(status)}`)
    }
    await new Promise(r => setTimeout(r, 4000))
  }
  throw new Error(`meshy request timed out after ${maxWaitMs}ms`)
}

export async function generateTextured(imageUrl, opts = {}) {
  const queueResp = await falPost(MESHY_ENDPOINT, {
    image_url: imageUrl,
    enable_pbr: true,
    ...opts
  })
  const result = await falPollResult(MESHY_ENDPOINT, queueResp.request_id)

  const glbUrl = result.model_mesh?.url || result.glb_url
  const stlUrl = result.model_mesh?.stl_url || null
  if (!glbUrl) throw new Error('No GLB URL in meshy response: ' + JSON.stringify(result))

  return {
    glb_url: glbUrl,
    stl_url: stlUrl,
    cost_usd: 0.60, // estimated mid-range
    model: 'meshy-v6',
    provider: 'meshy',
  }
}

export async function generateGeometry(imageUrl, opts = {}) {
  // Meshy doesn't have a separate untextured pass — use textured directly
  return generateTextured(imageUrl, opts)
}
