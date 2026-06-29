import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params
  const db = getDb()

  const order = db.prepare('SELECT state FROM orders WHERE id = ?').get(id) as { state: string } | undefined
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  // Address is collected at the quote stage — after the customer confirms the
  // design, before payment (then we'd pay the vendor). Allow quote + paid states.
  if (!['quote', 'paid'].includes(order.state)) {
    return NextResponse.json({ error: 'Address can only be captured at the quote stage' }, { status: 400 })
  }

  let body: { name?: string; street?: string; city?: string; state?: string; zip?: string; country?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.name || !body.street || !body.city || !body.zip || !body.country) {
    return NextResponse.json({ error: 'Missing required fields: name, street, city, zip, country' }, { status: 400 })
  }

  const address = {
    name: body.name,
    street: body.street,
    city: body.city,
    state: body.state || '',
    zip: body.zip,
    country: body.country,
  }

  // Store as event + mark captured — no Slant3D order call, no fulfillment.
  db.prepare(
    "INSERT INTO events (order_id, stage, event, message, data, created_at) VALUES (?, 'shipping', 'ship_to_captured', 'Shipping address captured (demo only)', ?, ?)"
  ).run(id, JSON.stringify(address), Date.now())
  db.prepare("UPDATE orders SET ship_to_status='captured', updated_at=? WHERE id=?").run(Date.now(), id)

  return NextResponse.json({ ok: true, message: 'Address captured — continue to payment' })
}
