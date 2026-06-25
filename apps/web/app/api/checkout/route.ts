import { NextRequest, NextResponse } from 'next/server'
import { getDb, requireDemoToken } from '@/lib/db'
import Stripe from 'stripe'

export async function POST(req: NextRequest) {
  if (!requireDemoToken(req)) {
    return NextResponse.json({ error: 'Invalid demo token' }, { status: 401 })
  }

  let body: { order_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { order_id } = body
  if (!order_id) return NextResponse.json({ error: 'order_id required' }, { status: 400 })

  const db = getDb()
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(order_id) as { state: string; description: string } | undefined
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const ledger = db.prepare('SELECT * FROM ledger WHERE order_id=?').get(order_id) as {
    revenue_cents: number
    vendor_cost_cents: number
    service_fee_cents: number
    gross_margin_pre_fees_cents: number
    quote_source: string
    currency: string
  } | undefined
  if (!ledger) return NextResponse.json({ error: 'No quote available — cannot checkout' }, { status: 400 })

  const spec = db.prepare('SELECT dfm_status, quote_status FROM spec WHERE order_id=?').get(order_id) as {
    dfm_status: string
    quote_status: string
  } | undefined
  if (spec?.dfm_status !== 'PASS') {
    return NextResponse.json({ error: 'DFM not passed — cannot checkout' }, { status: 400 })
  }

  // Gate on quote authenticity: manual/recorded quotes are not real vendor prices
  const isLiveQuote = ['live_api', 'browser'].includes(ledger.quote_source)
  if (!isLiveQuote && process.env.DEMO_ALLOW_PENDING_QUOTE !== 'true') {
    return NextResponse.json({
      error: 'Cannot check out: quote is based on recorded/demo pricing, not a live Sculpteo quote. Set DEMO_ALLOW_PENDING_QUOTE=true to allow in demo mode.',
      quote_source: ledger.quote_source,
    }, { status: 400 })
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }
  // Reject live keys — this pipeline is test-mode only
  if (!stripeKey.startsWith('sk_test_') && !stripeKey.startsWith('rk_test_')) {
    return NextResponse.json({ error: 'Live Stripe keys are not permitted — use test-mode keys only' }, { status: 500 })
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-04-10' })
  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  const currency = ledger.currency || 'usd'
  const currencySymbol = currency === 'eur' ? '€' : '$'

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency,
          unit_amount: ledger.revenue_cents,
          product_data: {
            name: `Hermaquette 3D Print — ${order.description.slice(0, 80)}`,
            description: [
              `Vendor cost: ${currencySymbol}${(ledger.vendor_cost_cents / 100).toFixed(2)}`,
              `Service fee (10%): ${currencySymbol}${(ledger.service_fee_cents / 100).toFixed(2)}`,
              'TEST MODE — no real charge',
              isLiveQuote ? `Live quote via ${ledger.quote_source}` : 'DEMO PRICING — recorded quote',
              'One-off personal gift · Not for resale · No affiliation claimed',
            ].join(' | '),
            metadata: { quote_source: ledger.quote_source },
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/order/${order_id}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/order/${order_id}?cancelled=true`,
    metadata: {
      order_id,
      hermaquette: 'true',
      test_mode: 'true',
    },
    payment_intent_data: {
      metadata: { order_id },
    },
  })

  return NextResponse.json({ url: session.url, session_id: session.id })
}
