/**
 * vendor-quote skill
 *
 * Stage: quote
 *
 * Calls the VendorQuoteAdapter to get a Sculpteo price for the STL.
 * Computes service fee (10%) and writes the ledger row.
 * Updates spec.quote_status and order.state → 'quote'.
 *
 * V2: Resolves the STL from payload.stl_url, payload.stl_path, or spec.stl_path
 * (in that priority order). Handles file:// stripping and HTTP URL download.
 * Checks Sculpteo printability verdict before returning the quote.
 *
 * The adapter is dynamically imported so this skill degrades gracefully
 * when the adapter package hasn't been written yet (early dev).
 */
import { createWriteStream, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { nanoid } from 'nanoid'
import { emitEvent } from '../job-processor.js'

/**
 * Resolve the STL path from payload and spec, handling file:// and HTTP URLs.
 * Priority: payload.stl_url → payload.stl_path → spec.stl_path
 * Returns a local filesystem path ready to pass to the vendor adapter.
 */
async function resolveStlPath(orderId, payload, spec) {
  const rawPath = payload.stl_url || payload.stl_path || spec.stl_path
  if (!rawPath) throw new Error(`No STL path available for order ${orderId}`)

  // file:// → strip prefix, use local path directly
  if (rawPath.startsWith('file://')) {
    return rawPath.slice('file://'.length)
  }

  // HTTP(S) URL → download to temp file (same pattern as dfm-repair.js)
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
    const tmpDir = join(tmpdir(), 'hermaquette-quote')
    try { mkdirSync(tmpDir, { recursive: true }) } catch {}
    const tmpStl = join(tmpDir, `${orderId}_${Date.now()}.stl`)
    const resp = await fetch(rawPath, { signal: AbortSignal.timeout(60_000) })
    if (!resp.ok) throw new Error(`Cannot download STL: HTTP ${resp.status} ${rawPath}`)
    const writer = createWriteStream(tmpStl)
    await pipeline(resp.body, writer)
    return tmpStl
  }

  // Already a local filesystem path
  return rawPath
}

export async function vendorQuote(db, orderId, payload) {
  const spec = db.prepare('SELECT * FROM spec WHERE order_id = ?').get(orderId)
  if (!spec) throw new Error(`Spec not found for order ${orderId}`)
  if (spec.dfm_status !== 'PASS') {
    throw new Error(`Cannot quote: DFM status is '${spec.dfm_status}', expected 'PASS'`)
  }

  emitEvent(db, orderId, 'quote', 'progress',
    'Hermes is requesting a vendor quote from Sculpteo…', {})

  // V2: resolve STL from payload.stl_url / payload.stl_path / spec.stl_path
  const stlPath = await resolveStlPath(orderId, payload, spec)
  const material = spec.material || 'pa12'

  // Try the real adapter; fall back to a manual estimate
  let quoteResult
  try {
    const { quote } = await import('../../packages/vendor/adapter.js')
    quoteResult = await quote({ stl_path: stlPath, material, qty: 1 })
  } catch (err) {
    console.warn('[vendor-quote] Adapter unavailable, using manual estimate:', err.message)
    quoteResult = {
      vendor_cost_cents: 3200,
      lead_time_days: 7,
      currency: 'usd',
      quote_source: 'manual',
    }
  }

  // Printability check — fail-closed for live vendor responses (B5 requirement)
  if (quoteResult.quote_source !== 'manual') {
    const printability = quoteResult.printability ?? quoteResult.status
    if (printability == null) {
      // Absent verdict = cannot verify — fail-closed, require manual review
      emitEvent(db, orderId, 'quote', 'printability_unverified',
        'Vendor did not return a printability verdict — needs manual review',
        { quote_source: quoteResult.quote_source })
      throw new Error('Vendor printability verdict absent — cannot auto-proceed to checkout (check Sculpteo API response format)')
    }
    const isPrintable = printability === 'printable' || printability === 'ok'
    if (!isPrintable) {
      emitEvent(db, orderId, 'quote', 'printability_failed',
        `Sculptor mesh rejected by vendor: printability="${printability}"`,
        { printability, quote_source: quoteResult.quote_source })
      throw new Error(`Vendor printability check failed: ${printability}`)
    }
  }

  // Financial model: 10% service fee
  const vendorCost     = quoteResult.vendor_cost_cents
  const serviceFeeCents = Math.round(vendorCost * 0.10)
  const revenueCents    = vendorCost + serviceFeeCents
  const grossMargin     = serviceFeeCents  // before Stripe processing fees

  // Idempotent: check for existing ledger row before inserting (safe on old non-unique schema)
  const existingLedger = db.prepare('SELECT id FROM ledger WHERE order_id = ?').get(orderId)
  const ledgerId = existingLedger ? existingLedger.id : nanoid()
  if (!existingLedger) {
    db.prepare(`
      INSERT INTO ledger (
        id, order_id, vendor_cost_cents, service_fee_cents, revenue_cents,
        gross_margin_pre_fees_cents, lead_time_days, currency, quote_source,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ledgerId, orderId, vendorCost, serviceFeeCents, revenueCents,
      grossMargin, quoteResult.lead_time_days, quoteResult.currency || 'usd',
      quoteResult.quote_source,
      Date.now(), Date.now(),
    )
  } else {
    db.prepare(`
      UPDATE ledger SET vendor_cost_cents=?, service_fee_cents=?, revenue_cents=?,
        gross_margin_pre_fees_cents=?, lead_time_days=?, currency=?, quote_source=?,
        updated_at=?
      WHERE order_id=?
    `).run(vendorCost, serviceFeeCents, revenueCents, grossMargin,
      quoteResult.lead_time_days, quoteResult.currency || 'usd', quoteResult.quote_source,
      Date.now(), orderId)
  }

  const quoteStatus = ['live_api', 'browser'].includes(quoteResult.quote_source) ? 'accepted' : 'pending'
  db.prepare(`UPDATE spec SET quote_status = ?, updated_at = ? WHERE order_id = ?`)
    .run(quoteStatus, Date.now(), orderId)

  db.prepare(`UPDATE orders SET state = 'quote', updated_at = ? WHERE id = ?`)
    .run(Date.now(), orderId)

  console.log(`[vendor-quote] order=${orderId} ledger=${ledgerId} revenue=${revenueCents}¢ source=${quoteResult.quote_source}`)

  return {
    ledger_id: ledgerId,
    vendor_cost_cents: vendorCost,
    service_fee_cents: serviceFeeCents,
    revenue_cents: revenueCents,
    gross_margin_pre_fees_cents: grossMargin,
    lead_time_days: quoteResult.lead_time_days,
    quote_source: quoteResult.quote_source,
    state: 'quote',
  }
}
