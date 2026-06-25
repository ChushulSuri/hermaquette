/**
 * Sculpteo browser automation adapter.
 * Uses Playwright to upload an STL and scrape the instant quote from the Sculpteo web UI.
 * Falls back gracefully if Playwright is not installed.
 *
 * @typedef {import('./adapter.js').QuoteResult} QuoteResult
 */

import fs from 'fs'

// Sculpteo instant-quote page
const SCULPTEO_QUOTE_URL = 'https://www.sculpteo.com/en/3d-printing-service/instant-quote/'

// Price selectors to try in order (Sculpteo UI changes occasionally)
const PRICE_SELECTORS = [
  '[data-testid="price"]',
  '[data-testid="instant-price"]',
  '.price-tag',
  '.instant-price',
  '.quote-price',
  '.price-amount',
  '[class*="price"]',
]

/**
 * Upload an STL via browser and scrape the quoted price.
 * @param {string} stl_path
 * @param {string} material
 * @param {number} qty
 * @returns {Promise<QuoteResult>}
 */
export async function quoteBrowser(stl_path, material, qty) {
  if (!fs.existsSync(stl_path)) throw new Error(`STL not found: ${stl_path}`)

  // Dynamic import so missing Playwright doesn't crash at module load
  let chromium
  try {
    const pw = await import('playwright')
    chromium = pw.chromium
  } catch (importErr) {
    throw new Error(`Playwright not available: ${importErr.message}`)
  }

  return _quoteBrowserPlaywright(stl_path, material, qty, chromium)
}

/**
 * @param {string} stl_path
 * @param {string} material
 * @param {number} qty
 * @param {import('playwright').BrowserType} chromium
 * @returns {Promise<QuoteResult>}
 */
async function _quoteBrowserPlaywright(stl_path, material, qty, chromium) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    acceptDownloads: false,
    locale: 'en-US',
  })
  const page = await context.newPage()

  try {
    console.log('[vendor:browser] Navigating to Sculpteo instant quote page...')
    await page.goto(SCULPTEO_QUOTE_URL, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    })

    // Accept cookie banner if present
    try {
      await page.click('[id*="accept"], [class*="accept-cookie"], button:has-text("Accept")', { timeout: 3_000 })
    } catch {
      // No cookie banner — continue
    }

    // Upload STL file
    console.log('[vendor:browser] Uploading STL...')
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.setInputFiles(stl_path)

    // Wait for price to appear — try each selector
    let priceText = null
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && priceText === null) {
      for (const sel of PRICE_SELECTORS) {
        try {
          const el = page.locator(sel).first()
          await el.waitFor({ timeout: 2_000 })
          priceText = await el.textContent()
          if (priceText && /\d/.test(priceText)) {
            console.log(`[vendor:browser] Price found via selector "${sel}": ${priceText}`)
            break
          }
          priceText = null
        } catch {
          // selector not found yet — keep looping
        }
      }
      if (!priceText) await page.waitForTimeout(2_000)
    }

    if (!priceText) throw new Error('Could not find price element on Sculpteo page after 90s')

    // Parse price — strip currency symbols, commas, spaces; keep digits and dot
    const priceMatch = priceText.replace(/[€$£,\s]/g, '').match(/\d+\.?\d*/)
    const price = priceMatch ? parseFloat(priceMatch[0]) : 0
    if (price === 0) throw new Error(`Could not parse price from text: "${priceText}"`)

    // Try to read lead time
    let lead_time_days = 7
    try {
      const deliveryText = await page.locator('[data-testid="delivery"], .delivery-time, [class*="delivery"]').first().textContent({ timeout: 3_000 })
      const daysMatch = deliveryText?.match(/(\d+)\s*(day|business)/i)
      if (daysMatch) lead_time_days = parseInt(daysMatch[1], 10)
    } catch {
      // Use default
    }

    await browser.close()

    return {
      vendor_cost_cents: Math.round(price * 100),
      lead_time_days,
      currency: 'eur',
      quote_source: 'browser',
      quote_url: SCULPTEO_QUOTE_URL,
      is_real_quote: true,
    }
  } catch (err) {
    await browser.close()
    throw err
  }
}
