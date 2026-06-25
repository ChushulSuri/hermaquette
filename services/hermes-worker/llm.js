/**
 * LLM provider shim
 *
 * Primary: OpenAI / GPT-4o  (OPENAI_API_KEY)
 * Designated NVIDIA step: Nemotron via nvidia.ai gateway (NEMOTRON_API_KEY)
 *
 * Steps in NEMOTRON_STEPS are routed to Nemotron when the key is present.
 * If Nemotron fails, the shim falls back to GPT so the pipeline never stalls.
 */
import OpenAI from 'openai'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o'
const NEMOTRON_MODEL = process.env.NEMOTRON_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct'
const NEMOTRON_BASE_URL = process.env.NEMOTRON_BASE_URL || 'https://integrate.api.nvidia.com/v1'

// Designated steps that should use NVIDIA Nemotron
const NEMOTRON_STEPS = new Set(['dfm_explanation', 'repair_narration'])

// ── Clients (lazy-init once, re-used across calls) ───────────────────────────

let _openai = null
let _nemotron = null

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
 *
 * @param {import('openai').OpenAI.ChatCompletionMessageParam[]} messages
 * @param {{ step?: string, model?: string, temperature?: number, max_tokens?: number }} opts
 * @returns {Promise<string>}  The assistant reply text
 */
export async function chat(messages, {
  step = 'default',
  model,
  temperature = 0.7,
  max_tokens = 1024,
} = {}) {
  const nemotron = getNemotron()
  const useNemotron = NEMOTRON_STEPS.has(step) && nemotron !== null

  if (useNemotron) {
    const selectedModel = model || NEMOTRON_MODEL
    try {
      console.log(`[llm] step=${step} provider=nemotron model=${selectedModel}`)
      const res = await nemotron.chat.completions.create({
        model: selectedModel,
        messages,
        temperature,
        max_tokens,
      })
      return res.choices[0].message.content
    } catch (err) {
      console.warn(`[llm] Nemotron unavailable for step=${step}, falling back to OpenAI:`, err.message)
      // fall through to OpenAI
    }
  }

  const selectedModel = (!useNemotron && model) ? model : OPENAI_MODEL
  console.log(`[llm] step=${step} provider=openai model=${selectedModel}`)
  const res = await getOpenAI().chat.completions.create({
    model: selectedModel,
    messages,
    temperature,
    max_tokens,
  })
  return res.choices[0].message.content
}

/**
 * GPT-4V vision query — always uses OpenAI (no Nemotron vision endpoint).
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
