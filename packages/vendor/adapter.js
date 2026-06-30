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

import { quoteLiveApi as quoteSlant3d } from './slant3d_live.js'
import { quoteLiveApi as quoteSculpteo } from './sculpteo_live.js'
import { quoteBrowser } from './sculpteo_browser.js'
import { quoteManual } from './manual.js'

/**
 * Get a vendor quote for an STL file, trying:
 *   Slant3D live API → Sculpteo live API → browser scrape → manual fallback.
 * @param {QuoteRequest} req
 * @returns {Promise<QuoteResult>}
 */
export async function quote(req) {
  const { stl_path, material, qty = 1, volume_mm3 } = req

  // Try Slant3D live API first (self-serve key, primary vendor)
  if (process.env.SLANT3D_API_KEY) {
    try {
      console.log('[vendor] Trying Slant3D live API...')
      const result = await quoteSlant3d(stl_path, material, qty)
      return { ...result, is_real_quote: true }
    } catch (err) {
      console.warn('[vendor] Slant3D API failed, trying next:', err.message)
    }
  }

  // Try Sculpteo live API (if a partner key is configured)
  if (process.env.SCULPTEO_API_KEY) {
    try {
      console.log('[vendor] Trying live Sculpteo API...')
      const result = await quoteSculpteo(stl_path, material, qty)
      return { ...result, is_real_quote: true }
    } catch (err) {
      console.warn('[vendor] Sculpteo API failed, trying browser:', err.message)
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

  // Manual / cached fallback (recording insurance) — volume-based estimate
  console.log('[vendor] Using manual/cached fallback quote')
  const result = await quoteManual(stl_path, material, qty, { volume_mm3 })
  return { ...result, is_real_quote: false }
}
