/**
 * LLM provider shim for Hermaquette.
 *
 * Routing rules:
 *   Primary orchestration / vision → OpenAI GPT-4o
 *   DFM explanation, repair narration → NVIDIA Nemotron (designated steps)
 *   Geometry decisions → NEVER use an LLM (KTD3 rule — handled in geometry module)
 */

import OpenAI from 'openai'

/** @type {OpenAI|null} */
let _openai = null

/** @type {OpenAI|null} */
let _nemotron = null

function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set')
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _openai
}

function getNemotron() {
  if (!_nemotron && process.env.NEMOTRON_API_KEY) {
    _nemotron = new OpenAI({
      apiKey: process.env.NEMOTRON_API_KEY,
      baseURL: process.env.NEMOTRON_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    })
  }
  return _nemotron
}

// Steps that must use Nemotron when available
const NEMOTRON_STEPS = new Set(['dfm_explanation', 'repair_narration'])

const NEMOTRON_MODEL = process.env.NEMOTRON_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct'
const OPENAI_MODEL   = process.env.OPENAI_MODEL   || 'gpt-4o'

/**
 * Chat completion with automatic provider routing.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ step?: string, max_tokens?: number, temperature?: number }} [options]
 * @returns {Promise<string>}
 */
export async function chat(messages, { step = 'default', max_tokens = 1024, temperature = 0.7 } = {}) {
  const nemotronClient = getNemotron()
  const useNemotron = NEMOTRON_STEPS.has(step) && nemotronClient !== null

  const client = useNemotron ? nemotronClient : getOpenAI()
  const model  = useNemotron ? NEMOTRON_MODEL   : OPENAI_MODEL

  try {
    const res = await client.chat.completions.create({ model, messages, max_tokens, temperature })
    console.log(`[llm] step=${step} provider=${useNemotron ? 'nemotron' : 'openai'} model=${model} tokens=${res.usage?.total_tokens ?? '?'}`)
    return res.choices[0].message.content || ''
  } catch (err) {
    if (useNemotron) {
      // Nemotron is preferred but not required — degrade gracefully
      console.warn(`[llm] Nemotron unavailable (${err.message}), falling back to OpenAI`)
      const fallback = await getOpenAI().chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        max_tokens,
        temperature,
      })
      console.log(`[llm] step=${step} provider=openai(fallback) model=${OPENAI_MODEL}`)
      return fallback.choices[0].message.content || ''
    }
    throw err
  }
}

/**
 * Vision analysis using GPT-4o (multimodal).
 * Nemotron is not used for vision — GPT-4o only.
 *
 * @param {string} imageUrl    - URL or data URI of the image
 * @param {string} prompt      - Text prompt to accompany the image
 * @param {{ max_tokens?: number }} [options]
 * @returns {Promise<string>}
 */
export async function vision(imageUrl, prompt, { max_tokens = 1024 } = {}) {
  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text',      text: prompt },
        ],
      },
    ],
    max_tokens,
  })
  console.log(`[llm] vision provider=openai model=gpt-4o tokens=${res.usage?.total_tokens ?? '?'}`)
  return res.choices[0].message.content || ''
}

/**
 * Simple single-turn completion (convenience wrapper around chat).
 * @param {string} userPrompt
 * @param {{ step?: string, max_tokens?: number, temperature?: number }} [options]
 * @returns {Promise<string>}
 */
export async function complete(userPrompt, options = {}) {
  return chat([{ role: 'user', content: userPrompt }], options)
}
