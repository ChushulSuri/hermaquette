/**
 * intake-research skill
 *
 * Stage: research
 *
 * 1. Reads the order description
 * 2. Asks GPT (via Hermes) for a depth-friendly description, material, colour, search
 *    keywords, and IP-sensitivity — it does NOT invent URLs
 * 3. Builds deterministic provenance (real verified URLs / Wikipedia search URLs) +
 *    deterministic rights framing, and writes a spec row with provenance JSON
 * 4. Updates order state to 'research_done'
 * 5. Enqueues the next stage: concept
 */
import { nanoid } from 'nanoid'
import { chat } from '../llm.js'
import { emitEvent } from '../job-processor.js'
import { dispatchToOrchestrator } from '../orchestrator.js'

export async function intakeResearch(db, orderId, payload) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
  if (!order) throw new Error(`Order ${orderId} not found`)

  emitEvent(db, orderId, 'research', 'progress',
    'Hermes is researching references and rights framing…', {})

  // The LLM does NOT invent URLs (it hallucinates them). It only produces the
  // front-facing description, a material recommendation, search KEYWORDS (not
  // links), the requested colour/finish, and whether the object references a
  // real brand/mascot/character (which tightens the rights disclaimer).
  // Provenance links are built deterministically below from real, always-valid
  // URLs — never fabricated by the model.
  const researchPrompt = `You are a manufacturing research assistant for Hermaquette, an AI-operated micro-manufacturing platform.

The customer wants to make a 3D-printed full-color decorative figure: "${order.description}"

Your tasks:
1. Produce a clean, single-subject description optimised for a 3D figure image-generation model
   (it will be used to generate a full-color 3D model — describe the character's overall shape,
   proportions, style, and main colors for the best 3D result; no background, no props).
2. List 2-3 reference search KEYWORDS (short phrases, NOT URLs) a person could search to find references.
3. Recommend a material: pa12 (SLS nylon, durable, recommended default), resin (SLA, fine detail), or tpu (flexible).
4. Capture the requested colour/finish if the customer mentioned one (e.g. "black", "natural"); else "natural".
5. Set ip_sensitive=true if the object references a real brand, mascot, logo, or named character.

Respond ONLY with valid JSON — no markdown, no commentary:
{
  "front_facing_description": "…",
  "reference_keywords": ["…", "…"],
  "material_recommendation": "pa12",
  "color": "natural",
  "ip_sensitive": false
}`

  const raw = await chat([
    { role: 'system', content: 'You are a precise manufacturing research assistant. Respond ONLY with valid JSON — no markdown fences, no explanation. Never invent URLs.' },
    { role: 'user', content: researchPrompt },
  ], { step: 'research', max_tokens: 1024, temperature: 0.3 })

  let research
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    research = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
  } catch {
    console.warn('[intake-research] JSON parse failed, using defaults. Raw:', raw.slice(0, 200))
    research = {}
  }

  const material = research.material_recommendation || order.material || 'pa12'
  const color = research.color || order.color || 'natural'

  // Rights framing is DETERMINISTIC, never LLM-decided. IP-sensitive objects
  // (or anything referencing Nous/Hermes) get the strict not-for-resale disclaimer.
  const lowerDesc = (order.description || '').toLowerCase()
  const isNousHero = /\bnous\b|\bhermes\b|nous girl/.test(lowerDesc)
  const rights_framing =
    (research.ip_sensitive || isNousHero)
      ? 'one-off personal gift, not for resale, no affiliation, endorsement, or licence claimed'
      : 'one-off personal gift, not for resale'

  // Provenance built from REAL, always-valid URLs — never fabricated by the model.
  const provenance = buildProvenance(order.description, research.reference_keywords, isNousHero)

  research.front_facing_description = research.front_facing_description || order.description
  research.rights_framing = rights_framing
  research.provenance = provenance

  // Write spec row
  const specId = nanoid()
  db.prepare(`
    INSERT INTO spec (
      id, order_id, material, process, dfm_status, vendor, quote_status,
      ship_to_status, provenance, created_at, updated_at
    ) VALUES (?, ?, ?, 'SLS', 'NEEDS_REVIEW', 'sculpteo', 'pending', 'address_pending', ?, ?, ?)
  `).run(specId, orderId, material, JSON.stringify(provenance), Date.now(), Date.now())

  // Update order state and material
  db.prepare(`UPDATE orders SET state = 'research_done', material = ?, updated_at = ? WHERE id = ?`)
    .run(material, Date.now(), orderId)

  console.log(`[intake-research] order=${orderId} specId=${specId} material=${material} color=${color}`)

  const result = {
    specId,
    provenance: research.provenance,
    rights_framing: research.rights_framing,
    front_facing_description: research.front_facing_description || order.description,
    material_recommendation: material,
    color,
    description: research.front_facing_description || order.description,
  }

  // Hand off to Hermaquette orchestrator (gateway) or direct skill pipeline
  await dispatchToOrchestrator(db, orderId, result)

  return { ...result, next_stage: 'concept' }
}

/**
 * Build provenance from REAL, always-valid URLs — the model never fabricates links.
 * - Nous/Hermes hero → known, verified reference URLs.
 * - General objects → Wikipedia SEARCH URLs (always resolve, never 404), labelled unverified.
 */
function buildProvenance(description, keywords, isNousHero) {
  const out = []
  if (isNousHero) {
    out.push({ url: 'https://shop.nousresearch.com/collections/products', title: 'Nous Research shop (public references)', notes: 'Nous Girl visual motif', verified: true })
    out.push({ url: 'https://hermes-agent.nousresearch.com/', title: 'Hermes Agent — Nous Research', notes: 'Hermes Agent positioning', verified: true })
  }
  const kws = Array.isArray(keywords) && keywords.length ? keywords : [description]
  for (const kw of kws.slice(0, 3)) {
    if (!kw) continue
    out.push({
      url: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(kw)}`,
      title: `Reference search: ${kw}`,
      notes: 'AI-suggested search — Hermes did not fetch or verify the page',
      verified: false,
    })
  }
  return out.length ? out : [{
    url: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(description || 'reference')}`,
    title: 'Reference search', notes: 'AI-suggested search', verified: false,
  }]
}
