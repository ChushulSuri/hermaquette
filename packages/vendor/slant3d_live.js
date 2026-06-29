/**
 * Slant3D live API adapter.
 * Slant3D's cloud slicer takes a PUBLIC URL to the STL and returns an instant price.
 * Our STL is already served publicly at PUBLIC_BASE_URL/api/artifacts/<path>, so no upload step.
 *
 *   POST https://www.slant3dapi.com/api/slicer
 *   headers: { api-key: <SLANT3D_API_KEY>, Content-Type: application/json }
 *   body:    { "fileURL": "<public STL url>" }
 *   resp:    { message, data: { price, ... } }   // price in USD
 *
 * Docs: https://www.slant3dapi.com/documentation
 *
 * @typedef {import('./adapter.js').QuoteResult} QuoteResult
 */

import fs from 'fs'
import fetch from 'node-fetch'

const SLANT3D_API_URL = process.env.SLANT3D_API_URL || 'https://www.slant3dapi.com/api'
const SLANT3D_API_KEY = process.env.SLANT3D_API_KEY || ''
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/artifacts'
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ''
const LEAD_TIME_DAYS = Number(process.env.SLANT3D_LEAD_TIME_DAYS || 5) // Slant3D fulfils in ~3-5 days

/**
 * Build the public URL Slant3D's servers can fetch the STL from.
 * Accepts either a local artifacts path or an already-public URL.
 * @param {string} stl_path
 * @returns {string}
 */
function publicStlUrl(stl_path) {
  if (/^https?:\/\//.test(stl_path)) return stl_path
  if (!PUBLIC_BASE_URL) {
    throw new Error('PUBLIC_BASE_URL not set — Slant3D needs a publicly reachable STL URL')
  }
  const rel = stl_path.startsWith(ARTIFACTS_DIR) ? stl_path.slice(ARTIFACTS_DIR.length) : stl_path
  const base = PUBLIC_BASE_URL.replace(/\/$/, '')
  const path = rel.startsWith('/') ? rel : `/${rel}`
  return `${base}/api/artifacts${path}`
}

/**
 * Get an instant Slant3D price quote for an STL.
 * @param {string} stl_path - Absolute artifacts path OR a public URL to the STL
 * @param {string} material - internal material key (Slant3D prices FDM; informational here)
 * @param {number} qty
 * @returns {Promise<QuoteResult>}
 */
export async function quoteLiveApi(stl_path, material, qty = 1) {
  if (!SLANT3D_API_KEY) throw new Error('SLANT3D_API_KEY not set')
  if (!/^https?:\/\//.test(stl_path) && !fs.existsSync(stl_path)) {
    throw new Error(`STL not found: ${stl_path}`)
  }

  const fileURL = publicStlUrl(stl_path)
  console.log(`[vendor:slant3d] Slicing ${fileURL}`)

  const res = await fetch(`${SLANT3D_API_URL}/slicer`, {
    method: 'POST',
    headers: { 'api-key': SLANT3D_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileURL }),
    timeout: 60_000, // slicing can take a while
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Slant3D slicer failed (${res.status}): ${body}`)
  }

  const data = await res.json()
  // Be defensive about the exact response shape.
  const priceUnits = data?.data?.price ?? data?.price ?? data?.data?.total ?? null
  if (priceUnits == null || Number.isNaN(Number(priceUnits))) {
    throw new Error(`Slant3D returned no usable price: ${JSON.stringify(data).slice(0, 300)}`)
  }

  const total = Number(priceUnits) * (qty > 1 ? qty : 1)
  const vendor_cost_cents = Math.round(total * 100)

  console.log(`[vendor:slant3d] Quote: USD ${(vendor_cost_cents / 100).toFixed(2)} (qty ${qty})`)

  return {
    vendor_cost_cents,
    lead_time_days: LEAD_TIME_DAYS,
    currency: 'usd',
    quote_source: 'live_api',
    quote_url: 'https://www.slant3d.com/',
    is_real_quote: true,
    raw: data,
  }
}
