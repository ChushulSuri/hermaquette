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

    // Update ledger
    db.prepare(`
      UPDATE ledger SET stripe_session_id=?, stripe_payment_status='paid', updated_at=?
      WHERE order_id=?
    `).run(session_id, now, order_id)

    // Update order state
    db.prepare('UPDATE orders SET state=?, updated_at=? WHERE id=?')
      .run('paid', now, order_id)

    // Emit event
    db.prepare(`
      INSERT INTO events (order_id, stage, event, message, data, created_at)
      VALUES (?, 'payment', 'confirmed', 'Hermes confirmed payment via Stripe (TEST MODE)', ?, ?)
    `).run(order_id, JSON.stringify({ session_id, amount: session.amount_total }), now)

    // Enqueue checkout gate
    const { nanoid } = await import('nanoid')
    const jobId = nanoid(21)
    db.prepare(`INSERT INTO jobs (id, order_id, stage, status, payload, queued_at) VALUES (?, ?, 'checkout_gate', 'queued', ?, ?)`)
      .run(jobId, order_id, JSON.stringify({ session_id }), now)
  }

  return NextResponse.json({
    paid: true,
    payment_status: 'paid',
    order_state: 'paid',
    amount_total: session.amount_total,
  })
}
