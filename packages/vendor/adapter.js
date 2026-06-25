/**
 * VendorQuoteAdapter — uniform interface over Sculpteo API, browser, and manual fallback.
 * quote_source determines whether the spec can be marked 'accepted' (R9 honesty rule).
 *
 * @typedef {'pa12'|'resin'|'tpu'|string} Material
 *
 * @typedef {Object} QuoteRequest
 * @property {string} stl_path
 * @property {Material} material
 * @property {number} [qty]
 *
 * @typedef {Object} QuoteResult
 * @property {number} vendor_cost_cents
 * @property {number} lead_time_days
 * @property {string} currency
 * @property {'live_api'|'browser'|'manual'|'cached'} quote_source
 * @property {string} [quote_url]
 * @property {Record<string,unknown>} [raw]
 * @property {boolean} is_real_quote - Only true when quote_source is live_api or browser (R9)
 */

import { quoteLiveApi } from './sculpteo_live.js'
import { quoteBrowser } from './sculpteo_browser.js'
import { quoteManual } from './manual.js'

/**
 * Get a vendor quote for an STL file, trying live API → browser → manual fallback.
 * @param {QuoteRequest} req
 * @returns {Promise<QuoteResult>}
 */
export async function quote(req) {
  const { stl_path, material, qty = 1 } = req

  // Try live API first
  if (process.env.SCULPTEO_API_KEY) {
    try {
      console.log('[vendor] Trying live Sculpteo API...')
      const result = await quoteLiveApi(stl_path, material, qty)
      return { ...result, is_real_quote: true }
    } catch (err) {
      console.warn('[vendor] Live API failed, trying browser:', err.message)
    }
  }

  // Try browser automation
  try {
    console.log('[vendor] Trying browser automation...')
    const result = await quoteBrowser(stl_path, material, qty)
    return { ...result, is_real_quote: true }
  } catch (err) {
    console.warn('[vendor] Browser automation failed, using manual fallback:', err.message)
  }

  // Manual / cached fallback (recording insurance)
  console.log('[vendor] Using manual/cached fallback quote')
  const result = await quoteManual(stl_path, material, qty)
  return { ...result, is_real_quote: false }
}
