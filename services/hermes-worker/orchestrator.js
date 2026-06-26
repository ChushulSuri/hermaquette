/**
 * orchestrator.js — called at the END of intake-research to hand the order
 * off to the Hermaquette orchestrator agent (or the direct skill pipeline).
 *
 * Gateway mode (HERMES_GATEWAY_URL reachable): POST to Hermes gateway, which
 * runs the real Hermaquette orchestrator agent; that agent uses delegate_task
 * to reach the Sculptor and Follow-up agents.
 *
 * Direct mode (fallback): enqueue the 'concept' job so the JS skill pipeline
 * continues (concept → image-to-3d → dfm-repair → quote → …).
 * Does NOT re-enqueue 'research' — that would cause an infinite loop.
 */
import { emitEvent, enqueueJob } from './job-processor.js'

const HERMES_GATEWAY_URL = process.env.HERMES_GATEWAY_URL || 'http://127.0.0.1:8642'
const GATEWAY_TIMEOUT_MS = 3000

async function isGatewayAvailable() {
  try {
    const resp = await fetch(`${HERMES_GATEWAY_URL}/health`, {
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS)
    })
    return resp.ok
  } catch {
    return false
  }
}

/**
 * Hand off this order to the Hermaquette orchestrator agent (or skill pipeline).
 * Call this at the end of intake-research, passing the research result as context.
 */
export async function dispatchToOrchestrator(db, orderId, researchPayload) {
  if (await isGatewayAvailable()) {
    return dispatchViaGateway(db, orderId, researchPayload)
  }
  console.log('[orchestrator] Hermes gateway not reachable — direct skill pipeline')
  return dispatchViaSkillPipeline(db, orderId, researchPayload)
}

async function dispatchViaGateway(db, orderId, researchPayload) {
  emitEvent(db, orderId, 'orchestrator', 'delegated',
    'Hermaquette orchestrator is taking over the order', { agent: 'Hermaquette' })

  const message = `New order ${orderId} — research complete. Description: ${researchPayload.front_facing_description || ''}`

  const resp = await fetch(`${HERMES_GATEWAY_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      agent: 'hermaquette-orchestrator',
      context: { orderId, ...researchPayload }
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!resp.ok) {
    // Gateway responded but errored — fall back to direct pipeline
    console.warn(`[orchestrator] Gateway error ${resp.status} — falling back to direct pipeline`)
    return dispatchViaSkillPipeline(db, orderId, researchPayload)
  }

  const result = await resp.json()
  emitEvent(db, orderId, 'orchestrator', 'agent_delegated',
    'Hermaquette delegated to Sculptor via delegate_task', { agent: 'Hermaquette', target: 'Sculptor' })
  return result
}

function dispatchViaSkillPipeline(db, orderId, researchPayload) {
  // Direct mode: advance to 'concept' — the research stage already ran
  enqueueJob(db, orderId, 'concept', {
    description: researchPayload.front_facing_description || researchPayload.description,
    material: researchPayload.material_recommendation || 'pa12',
    color: researchPayload.color || 'natural',
  })
  emitEvent(db, orderId, 'orchestrator', 'pipeline_started',
    'Hermaquette skill pipeline started (direct mode)', { agent: 'Hermaquette' })
}
