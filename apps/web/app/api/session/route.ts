import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import Stripe from 'stripe'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const session_id = searchParams.get('session_id')
  const order_id = searchParams.get('order_id')

  if (!session_id || !order_id) {
    return NextResponse.json({ error: 'session_id and order_id required' }, { status: 400 })
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' })

  // Server-side retrieve — trust the session, not just the redirect
  const session = await stripe.checkout.sessions.retrieve(session_id)

  const db = getDb()
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(order_id) as { state: string } | undefined
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Verify the session belongs to this order
  if (session.metadata?.order_id !== order_id) {
    return NextResponse.json({ error: 'Session/order mismatch' }, { status: 400 })
  }

  if (session.payment_status !== 'paid') {
    return NextResponse.json({
      paid: false,
      payment_status: session.payment_status,
      order_state: order.state,
    })
  }

  // Idempotent: only update if not already marked paid
  if (order.state !== 'paid') {
    const now = Date.now()

    // Update order state + set payment_confirmed_at (precondition for Approve button)
    db.prepare('UPDATE orders SET state=?, payment_confirmed_at=?, updated_at=? WHERE id=?')
      .run('paid', now, now, order_id)

    // Update ledger idempotently — ledger row may already exist from vendor-quote (Run 1)
    const existingLedger = db.prepare('SELECT id FROM ledger WHERE order_id=?').get(order_id)
    if (existingLedger) {
      db.prepare("UPDATE ledger SET stripe_session_id=?, stripe_payment_status='paid', updated_at=? WHERE order_id=?")
        .run(session_id, now, order_id)
    } else {
      // Edge case: vendor-quote hasn't run yet — create a minimal ledger row to record the payment
      const { nanoid } = await import('nanoid')
      db.prepare(`INSERT INTO ledger (id, order_id, vendor_cost_cents, service_fee_cents, revenue_cents, gross_margin_pre_fees_cents, stripe_session_id, stripe_payment_status, created_at, updated_at) VALUES (?, ?, 0, 0, ?, 0, ?, 'paid', ?, ?)`)
        .run(nanoid(21), order_id, session.amount_total || 0, session_id, now, now)
    }

    // Emit payment confirmed event
    db.prepare(`
      INSERT INTO events (order_id, stage, event, message, data, created_at)
      VALUES (?, 'payment', 'confirmed', 'Payment confirmed via Stripe (TEST MODE)', ?, ?)
    `).run(order_id, JSON.stringify({ session_id, amount: session.amount_total }), now)

    // No job enqueue — Run 2 is dispatched by the human Approve button
  }

  return NextResponse.json({
    paid: true,
    payment_status: 'paid',
    order_state: 'paid',
    amount_total: session.amount_total,
  })
}
