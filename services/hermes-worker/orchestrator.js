/**
 * orchestrator.js — dispatch an order to the Hermaquette orchestrator agent
 * via the Hermes gateway HTTP API.
 * Falls back to direct job-processor if gateway unavailable.
 */
import { emitEvent, enqueueJob } from './job-processor.js'

const HERMES_GATEWAY_URL = process.env.HERMES_GATEWAY_URL || 'http://localhost:8642'
const GATEWAY_TIMEOUT_MS = 5000

// Check if Hermes gateway is reachable
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

// Dispatch an order to the Hermaquette orchestrator agent
export async function dispatchToOrchestrator(db, orderId, payload) {
  // Try Hermes gateway first
  if (await isGatewayAvailable()) {
    return dispatchViaGateway(db, orderId, payload)
  }
  // Fall back to job-processor stage machine
  console.log('[orchestrator] Hermes gateway unavailable, falling back to job-processor')
  return dispatchViaJobQueue(db, orderId, payload)
}

async function dispatchViaGateway(db, orderId, payload) {
  emitEvent(db, orderId, 'orchestrator', 'started',
    'Hermaquette is understanding your request', { agent: 'Hermaquette' })

  // POST to Hermes gateway to start an agent session
  const message = `Order ${orderId}: ${JSON.stringify(payload)}`

  const resp = await fetch(`${HERMES_GATEWAY_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      agent: 'hermaquette-orchestrator',
      context: { orderId, ...payload }
    })
  })

  if (!resp.ok) {
    throw new Error(`Hermes gateway error: ${resp.status}`)
  }

  const result = await resp.json()

  emitEvent(db, orderId, 'orchestrator', 'delegated',
    'Hermaquette delegated to Sculptor', { agent: 'Hermaquette', target: 'Sculptor' })

  return result
}

async function dispatchViaJobQueue(db, orderId, payload) {
  // Fall back to V1 job queue
  enqueueJob(db, orderId, 'research', payload)
}
