/**
 * LLM provider shim
 *
 * Primary (non-Nemotron steps): Hermes gateway at localhost:8642
 *   Hermes runs the actual hermes-agent runtime with our hermaquette skills
 *   loaded, so every LLM call goes through the agent that judges can see.
 *   Falls back to OpenAI directly if the gateway isn't running.
 *
 * Designated NVIDIA steps: Nemotron via nvidia.ai gateway (direct, no Hermes proxy)
 *   Steps in NEMOTRON_STEPS are routed to Nemotron when the key is present.
 *   Falls back to Hermes/OpenAI if Nemotron is unavailable.
 */
import OpenAI from 'openai'

const OPENAI_MODEL        = process.env.OPENAI_MODEL        || 'gpt-4o'
const NEMOTRON_MODEL      = process.env.NEMOTRON_MODEL      || 'nvidia/llama-3.1-nemotron-70b-instruct'
const NEMOTRON_BASE_URL   = process.env.NEMOTRON_BASE_URL   || 'https://integrate.api.nvidia.com/v1'
const HERMES_GATEWAY_URL  = process.env.HERMES_GATEWAY_URL  || 'http://127.0.0.1:8642/v1'
const HERMES_API_KEY      = process.env.HERMES_API_KEY      || 'hermaquette-local'

// Designated steps that use NVIDIA Nemotron directly (NVIDIA sponsor beat)
const NEMOTRON_STEPS = new Set(['dfm_explanation', 'repair_narration'])

// ── Clients (lazy-init, re-used across calls) ────────────────────────────────

let _hermes   = null
let _openai   = null
let _nemotron = null

function getHermes() {
  if (!_hermes) {
    _hermes = new OpenAI({ apiKey: HERMES_API_KEY, baseURL: HERMES_GATEWAY_URL })
  }
  return _hermes
}

function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set')
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _openai
}

function getNemotron() {
  if (!process.env.NEMOTRON_API_KEY) return null
  if (!_nemotron) {
    _nemotron = new OpenAI({
      apiKey: process.env.NEMOTRON_API_KEY,
      baseURL: NEMOTRON_BASE_URL,
    })
  }
  return _nemotron
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a chat completion request.
 * Routing:
 *   NEMOTRON_STEPS → Nemotron (NVIDIA beat) → fallback Hermes/OpenAI
 *   all others     → Hermes gateway (actual agent runtime) → fallback OpenAI
 *
 * @param {import('openai').OpenAI.ChatCompletionMessageParam[]} messages
 * @param {{ step?: string, model?: string, temperature?: number, max_tokens?: number }} opts
 * @returns {Promise<string>}
 */
export async function chat(messages, {
  step        = 'default',
  model,
  temperature = 0.7,
  max_tokens  = 1024,
} = {}) {

  // ── Nemotron path ─────────────────────────────────────────────────────────
  if (NEMOTRON_STEPS.has(step)) {
    const nemotron = getNemotron()
    if (nemotron) {
      const m = model || NEMOTRON_MODEL
      try {
        console.log(`[llm] step=${step} provider=nemotron model=${m}`)
        const res = await nemotron.chat.completions.create({
          model: m, messages, temperature, max_tokens,
        })
        return res.choices[0].message.content
      } catch (err) {
        console.warn(`[llm] Nemotron unavailable for step=${step}, falling back:`, err.message)
      }
    }
  }

  // ── Hermes gateway path (primary for all non-Nemotron steps) ─────────────
  try {
    console.log(`[llm] step=${step} provider=hermes-gateway`)
    const res = await getHermes().chat.completions.create({
      model: 'hermes',   // ignored server-side; Hermes uses its own configured model
      messages,
      temperature,
      max_tokens,
    })
    return res.choices[0].message.content
  } catch (err) {
    console.warn(`[llm] Hermes gateway unavailable for step=${step}, falling back to OpenAI:`, err.message)
  }

  // ── OpenAI fallback ───────────────────────────────────────────────────────
  const m = model || OPENAI_MODEL
  console.log(`[llm] step=${step} provider=openai model=${m}`)
  const res = await getOpenAI().chat.completions.create({
    model: m, messages, temperature, max_tokens,
  })
  return res.choices[0].message.content
}

/**
 * Vision query — always OpenAI (GPT-4o), no Nemotron/Hermes vision routing yet.
 *
 * @param {string} imageUrl
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function vision(imageUrl, prompt) {
  console.log('[llm] vision request via gpt-4o')
  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
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
