/**
 * Sculpteo live API adapter.
 * Uploads STL → gets an instant quote.
 * API docs: https://www.sculpteo.com/en/services/api-services/
 *
 * @typedef {import('./adapter.js').QuoteResult} QuoteResult
 */

import fs from 'fs'
import { createReadStream } from 'fs'
import FormData from 'form-data'
import fetch from 'node-fetch'

const SCULPTEO_API_URL = process.env.SCULPTEO_API_URL || 'https://www.sculpteo.com/api/1'
const SCULPTEO_API_KEY = process.env.SCULPTEO_API_KEY || ''

// Sculpteo material IDs mapped from our internal names
const MATERIAL_MAP = {
  pa12:  { material: 'plastic',   color: 'white' },
  resin: { material: 'resin',     color: 'white' },
  tpu:   { material: 'multijet',  color: 'white' },
}

/**
 * Upload an STL to Sculpteo and retrieve an instant price quote.
 * @param {string} stl_path - Absolute path to the STL file
 * @param {string} material - Material key ('pa12', 'resin', 'tpu', ...)
 * @param {number} qty      - Quantity
 * @returns {Promise<QuoteResult>}
 */
export async function quoteLiveApi(stl_path, material, qty) {
  if (!SCULPTEO_API_KEY) throw new Error('SCULPTEO_API_KEY not set')
  if (!fs.existsSync(stl_path)) throw new Error(`STL not found: ${stl_path}`)

  const matConfig = MATERIAL_MAP[material] || MATERIAL_MAP.pa12
  const authHeader = `Basic ${Buffer.from(`${SCULPTEO_API_KEY}:`).toString('base64')}`

  // ── Step 1: Upload design ──────────────────────────────────────────────────
  const formData = new FormData()
  formData.append('file', createReadStream(stl_path), {
    filename: 'model.stl',
    contentType: 'application/octet-stream',
  })
  formData.append('name', `hermaquette-${Date.now()}`)
  formData.append('unit', 'mm')
  formData.append('accept_tos', '1')

  const uploadRes = await fetch(`${SCULPTEO_API_URL}/upload/`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      ...formData.getHeaders(),
    },
    body: formData,
  })

  if (!uploadRes.ok) {
    const body = await uploadRes.text()
    throw new Error(`Sculpteo upload failed (${uploadRes.status}): ${body}`)
  }

  const uploadData = await uploadRes.json()
  const designId = uploadData.id || uploadData.uuid || uploadData.slug
  if (!designId) throw new Error(`Upload returned no design ID: ${JSON.stringify(uploadData)}`)

  console.log(`[vendor:live] Design uploaded, id=${designId}`)

  // ── Step 2: Get instant quote ──────────────────────────────────────────────
  const quoteUrl = new URL(`${SCULPTEO_API_URL}/price/`)
  quoteUrl.searchParams.set('uuid', designId)
  quoteUrl.searchParams.set('material', matConfig.material)
  quoteUrl.searchParams.set('color', matConfig.color)
  quoteUrl.searchParams.set('quantity', String(qty))
  quoteUrl.searchParams.set('unit', 'mm')

  const quoteRes = await fetch(quoteUrl.toString(), {
    headers: { Authorization: authHeader },
  })

  if (!quoteRes.ok) {
    const body = await quoteRes.text()
    throw new Error(`Sculpteo quote failed (${quoteRes.status}): ${body}`)
  }

  const quoteData = await quoteRes.json()

  // Sculpteo returns price in the design's currency (usually EUR)
  const priceUnits = quoteData.price ?? quoteData.total ?? 0
  const vendor_cost_cents = Math.round(Number(priceUnits) * 100)

  console.log(`[vendor:live] Quote: ${quoteData.currency ?? 'eur'} ${(vendor_cost_cents / 100).toFixed(2)}`)

  return {
    vendor_cost_cents,
    lead_time_days: quoteData.delivery_time ?? 7,
    currency: (quoteData.currency ?? 'eur').toLowerCase(),
    quote_source: 'live_api',
    quote_url: `https://www.sculpteo.com/en/design/${designId}/`,
    is_real_quote: true,
    raw: quoteData,
  }
}
