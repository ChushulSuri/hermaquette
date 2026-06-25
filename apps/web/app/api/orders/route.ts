import { NextRequest, NextResponse } from 'next/server'
import { getDb, requireDemoToken } from '@/lib/db'
import { nanoid } from 'nanoid'

const MAX_DESCRIPTION_LENGTH = 2000
const MIN_DESCRIPTION_LENGTH = 10

export async function POST(req: NextRequest) {
  // DEMO_TOKEN gate — prevents accidental expensive runs
  if (!requireDemoToken(req)) {
    return NextResponse.json({ error: 'Invalid demo token' }, { status: 401 })
  }

  // Request size limit (intake body)
  const contentLength = req.headers.get('content-length')
  if (contentLength && parseInt(contentLength) > 10_000) {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }

  let body: { description?: string; material?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { description, material = 'pa12' } = body

  if (!description || description.trim().length < MIN_DESCRIPTION_LENGTH) {
    return NextResponse.json({ error: `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters` }, { status: 400 })
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json({ error: `Description too long (max ${MAX_DESCRIPTION_LENGTH} chars)` }, { status: 400 })
  }

  const validMaterials = ['pa12', 'resin', 'tpu']
  if (!validMaterials.includes(material)) {
    return NextResponse.json({ error: 'Invalid material' }, { status: 400 })
  }

  const db = getDb()
  const orderId = nanoid(21)  // unguessable, non-sequential
  const now = Date.now()

  db.prepare(`
    INSERT INTO orders (id, state, description, material, created_at, updated_at)
    VALUES (?, 'intake', ?, ?, ?, ?)
  `).run(orderId, description.trim(), material, now, now)

  // Enqueue research job
  const jobId = nanoid(21)
  db.prepare(`
    INSERT INTO jobs (id, order_id, stage, status, payload, queued_at)
    VALUES (?, ?, 'research', 'queued', ?, ?)
  `).run(jobId, orderId, JSON.stringify({ description: description.trim(), material }), now)

  return NextResponse.json({ id: orderId, state: 'intake' }, { status: 201 })
}
