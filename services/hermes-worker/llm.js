/**
 * LLM gateway shim — the worker NEVER holds provider credentials or
 * instantiates direct OpenAI/Nemotron clients. All calls go through a
 * Hermes gateway process running in this container (started by start.sh).
 *
 * Two Hermes gateway instances (both localhost, started by start.sh):
 *   Port 8642 — primary (GPT-5.5 / ChatGPT OAuth)
 *   Port 8643 — Nemotron (NVIDIA / NEMOTRON_API_KEY)
 *
 * NEMOTRON_STEPS are routed to port 8643. All other steps use port 8642.
 * Vision requests go to port 8642 (primary gateway handles vision via its
 * configured auxiliary.vision model).
 *
 * If the Nemotron gateway is not running (NEMOTRON_API_KEY absent),
 * NEMOTRON_STEPS fall back to the primary gateway automatically.
 */
import OpenAI from 'openai'

const HERMES_GATEWAY_URL     = process.env.HERMES_GATEWAY_URL          || 'http://127.0.0.1:8642/v1'
const HERMES_NEMOTRON_URL    = process.env.HERMES_NEMOTRON_GATEWAY_URL  || 'http://127.0.0.1:8643/v1'
const HERMES_API_KEY         = process.env.HERMES_API_KEY               || 'hermaquette-local'

// Steps routed to the Nemotron gateway (NVIDIA sponsor beat)
const NEMOTRON_STEPS = new Set(['dfm_explanation', 'repair_narration'])

let _primary  = null
let _nemotron = null

function getPrimary() {
  if (!_primary) _primary = new OpenAI({ apiKey: HERMES_API_KEY, baseURL: HERMES_GATEWAY_URL })
  return _primary
}

function getNemotronGateway() {
  if (!_nemotron) _nemotron = new OpenAI({ apiKey: HERMES_API_KEY, baseURL: HERMES_NEMOTRON_URL })
  return _nemotron
}

/**
 * Send a chat completion through the appropriate Hermes gateway.
 * NEMOTRON_STEPS → port 8643 (Hermes-Nemotron), with fallback to primary.
 * All others     → port 8642 (Hermes-primary, GPT-5.5).
 */
export async function chat(messages, {
  step        = 'default',
  temperature = 0.7,
  max_tokens  = 1024,
} = {}) {
  const useNemotron = NEMOTRON_STEPS.has(step)

  if (useNemotron) {
    try {
      console.log(`[llm] step=${step} gateway=hermes-nemotron`)
      const res = await getNemotronGateway().chat.completions.create({
        model: 'hermes', messages, temperature, max_tokens,
      })
      return res.choices[0].message.content
    } catch (err) {
      console.warn(`[llm] Nemotron gateway unavailable for step=${step}, falling back to primary:`, err.message)
    }
  }

  console.log(`[llm] step=${step} gateway=hermes-primary`)
  const res = await getPrimary().chat.completions.create({
    model: 'hermes', messages, temperature, max_tokens,
  })
  return res.choices[0].message.content
}

/**
 * Vision query — routed to the primary Hermes gateway.
 * Hermes handles vision via its configured auxiliary.vision model.
 */
export async function vision(imageUrl, prompt) {
  console.log('[llm] vision request via hermes-primary')
  const res = await getPrimary().chat.completions.create({
    model: 'hermes',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: prompt },
      ],
    }],
    max_tokens: 1024,
  })
  return res.choices[0].message.content
}
