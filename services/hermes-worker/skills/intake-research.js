/**
 * intake-research skill
 *
 * Stage: research
 *
 * 1. Reads the order description
 * 2. Asks GPT to identify reference URLs, rights framing, and material recommendation
 * 3. Writes a spec row with provenance JSON
 * 4. Updates order state to 'research_done'
 * 5. Enqueues the next stage: concept
 */
import { nanoid } from 'nanoid'
import { chat } from '../llm.js'
import { emitEvent } from '../job-processor.js'

export async function intakeResearch(db, orderId, payload) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
  if (!order) throw new Error(`Order ${orderId} not found`)

  emitEvent(db, orderId, 'research', 'progress',
    'Hermes is researching references and rights framing…', {})

  const researchPrompt = `You are a manufacturing research assistant for Hermaquette, an AI-operated micro-manufacturing platform.

The customer wants to make a 3D-printed decorative object: "${order.description}"

Your tasks:
1. Identify 2-3 real, publicly accessible reference URLs related to this object
   (Wikipedia, museum databases, official artist/manufacturer pages — NOT copyrighted image databases or stock photo sites)
2. Determine the appropriate rights framing for a one-off personal gift
3. Produce a clean front-facing description optimised for image-generation models
4. Recommend a material: pa12 (SLS nylon, most durable), resin (SLA, fine detail), or tpu (flexible)

Respond ONLY with valid JSON — no markdown, no commentary:
{
  "provenance": [
    {"url": "https://...", "title": "Source name", "notes": "why relevant"}
  ],
  "rights_framing": "one-off personal gift, not for resale, no affiliation or endorsement claimed",
  "front_facing_description": "…",
  "material_recommendation": "pa12"
}`

  const raw = await chat([
    { role: 'system', content: 'You are a precise manufacturing research assistant. Respond ONLY with valid JSON — no markdown fences, no explanation.' },
    { role: 'user', content: researchPrompt },
  ], { step: 'research', max_tokens: 1024, temperature: 0.3 })

  let research
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    research = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
  } catch {
    console.warn('[intake-research] JSON parse failed, using defaults. Raw:', raw.slice(0, 200))
    research = {
      provenance: [{ url: 'https://en.wikipedia.org', title: 'Reference (pending)', notes: 'placeholder' }],
      rights_framing: 'one-off personal gift, not for resale, no affiliation or endorsement claimed',
      front_facing_description: order.description,
      material_recommendation: order.material || 'pa12',
    }
  }

  const material = research.material_recommendation || order.material || 'pa12'

  // Write spec row
  const specId = nanoid()
  db.prepare(`
    INSERT INTO spec (
      id, order_id, material, process, dfm_status, vendor, quote_status,
      ship_to_status, provenance, created_at, updated_at
    ) VALUES (?, ?, ?, 'SLS', 'NEEDS_REVIEW', 'sculpteo', 'pending', 'address_pending', ?, ?, ?)
  `).run(specId, orderId, material, JSON.stringify(research.provenance), Date.now(), Date.now())

  // Update order state and material
  db.prepare(`UPDATE orders SET state = 'research_done', material = ?, updated_at = ? WHERE id = ?`)
    .run(material, Date.now(), orderId)

  // Enqueue concept image generation
  const jobId = nanoid()
  db.prepare(`
    INSERT INTO jobs (id, order_id, stage, status, payload, queued_at)
    VALUES (?, ?, 'concept', 'queued', ?, ?)
  `).run(jobId, orderId, JSON.stringify({
    description: research.front_facing_description || order.description,
    material,
  }), Date.now())

  console.log(`[intake-research] order=${orderId} specId=${specId} material=${material} nextJob=${jobId}`)

  return {
    specId,
    provenance: research.provenance,
    rights_framing: research.rights_framing,
    front_facing_description: research.front_facing_description,
    material_recommendation: material,
    next_stage: 'concept',
  }
}
