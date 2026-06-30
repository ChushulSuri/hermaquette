/**
 * Manual / cached quote fallback.
 * Replays a recorded quote. Labelled as "recording insurance" in the UI.
 *
 * HONESTY (R9): never sets quote_status=accepted in the spec.
 * is_real_quote is always false for this source.
 *
 * @typedef {import('./adapter.js').QuoteResult} QuoteResult
 */

// Volume-based estimate: a per-material handling base + a rate per cm³ of model
// volume, clamped to a sane band. This scales with the actual figure (from the
// DFM-measured volume) so the price isn't a flat number that's obviously off.
// Rates are approximate SLS/resin bureau economics — used only when the live
// vendor API is unavailable (still is_real_quote:false).
const ESTIMATE_RATES = {
  pa12:  { base_cents: 800, per_cm3_cents: 22, lead_time_days: 7 },
  resin: { base_cents: 800, per_cm3_cents: 28, lead_time_days: 5 },
  tpu:   { base_cents: 900, per_cm3_cents: 34, lead_time_days: 10 },
}
const MIN_UNIT_CENTS = 1000 // $10 floor (small-part handling)
const MAX_UNIT_CENTS = 6000 // $60 ceiling (sanity clamp)

// Flat fallback when the model volume isn't available.
const FLAT_FALLBACK_CENTS = { pa12: 1430, resin: 1380, tpu: 1450 }

/**
 * Return a recorded/estimated (non-live) fallback quote.
 * @param {string} stl_path
 * @param {string} material
 * @param {number} qty
 * @param {{ volume_mm3?: number }} [opts]  measured model volume (from DFM)
 * @returns {Promise<QuoteResult>}
 */
export async function quoteManual(stl_path, material, qty = 1, opts = {}) {
  const r = ESTIMATE_RATES[material] || ESTIMATE_RATES.pa12
  const volMm3 = Number(opts.volume_mm3) || 0

  let unit_cents
  let basis
  if (volMm3 > 0) {
    const volCm3 = volMm3 / 1000
    unit_cents = Math.round(r.base_cents + volCm3 * r.per_cm3_cents)
    unit_cents = Math.max(MIN_UNIT_CENTS, Math.min(MAX_UNIT_CENTS, unit_cents))
    basis = `${volCm3.toFixed(1)}cm³ × $${(r.per_cm3_cents / 100).toFixed(2)}/cm³ + $${(r.base_cents / 100).toFixed(2)} base`
  } else {
    unit_cents = FLAT_FALLBACK_CENTS[material] || FLAT_FALLBACK_CENTS.pa12
    basis = 'flat (volume unknown)'
  }

  const total_cents = unit_cents * qty
  console.log(`[vendor:manual] Estimate material=${material} qty=${qty}: USD ${(total_cents / 100).toFixed(2)} (${basis})`)

  return {
    vendor_cost_cents: total_cents,
    lead_time_days: r.lead_time_days,
    currency: 'usd',
    quote_source: 'manual',
    is_real_quote: false,
    raw: {
      source: 'estimate',
      material,
      qty,
      volume_mm3: volMm3,
      unit_cost_cents: unit_cents,
      basis,
      note: 'volume-based estimate; not a live vendor quote — cannot set quote_status=accepted (R9)',
    },
  }
}
