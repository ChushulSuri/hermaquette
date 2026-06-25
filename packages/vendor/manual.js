/**
 * Manual / cached quote fallback.
 * Replays a recorded quote. Labelled as "recording insurance" in the UI.
 *
 * HONESTY (R9): never sets quote_status=accepted in the spec.
 * is_real_quote is always false for this source.
 *
 * @typedef {import('./adapter.js').QuoteResult} QuoteResult
 */

// Recorded quotes for common materials (from actual Sculpteo pricing, June 2026)
// Source: manual quote run on a 100×80×6mm PA12 plaque, ~62cm³ volume
const RECORDED_QUOTES = {
  pa12:  { cost_cents: 3150, lead_time_days: 7,  currency: 'eur' }, // €31.50
  resin: { cost_cents: 2200, lead_time_days: 5,  currency: 'eur' }, // €22.00
  tpu:   { cost_cents: 4800, lead_time_days: 10, currency: 'eur' }, // €48.00
}

/**
 * Return a recorded (non-live) fallback quote.
 * @param {string} stl_path
 * @param {string} material
 * @param {number} qty
 * @returns {Promise<QuoteResult>}
 */
export async function quoteManual(stl_path, material, qty) {
  const recorded = RECORDED_QUOTES[material] || RECORDED_QUOTES.pa12
  const total_cents = recorded.cost_cents * qty

  console.log(
    `[vendor:manual] Recorded quote for material=${material} qty=${qty}: ` +
    `${recorded.currency.toUpperCase()} ${(total_cents / 100).toFixed(2)}`
  )

  return {
    vendor_cost_cents: total_cents,
    lead_time_days: recorded.lead_time_days,
    currency: recorded.currency,
    quote_source: 'manual',
    is_real_quote: false,
    raw: {
      source: 'recorded',
      material,
      qty,
      unit_cost_cents: recorded.cost_cents,
      note: 'recording insurance — not a live quote; cannot set quote_status=accepted (R9)',
    },
  }
}
