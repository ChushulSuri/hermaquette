import { NextRequest, NextResponse } from 'next/server'
import { getDb, requireDemoToken } from '@/lib/db'
import { hasValidAccessCookie } from '@/lib/auth'
import { nanoid } from 'nanoid'
import fs from 'fs'
import path from 'path'

const HERMES_URL = (process.env.HERMES_GATEWAY_URL || 'http://hermes-agent:8642').replace('/v1', '')
const HERMES_KEY = process.env.HERMES_API_KEY || 'hermaquette-local'

const MAX_DESCRIPTION_LENGTH = 2000
const MIN_DESCRIPTION_LENGTH = 10
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function POST(req: NextRequest) {
  // DEMO_TOKEN gate — prevents accidental expensive runs
  if (!requireDemoToken(req)) {
    return NextResponse.json({ error: 'Invalid demo token' }, { status: 401 })
  }

  // Access-code gate — prevents budget burn from random visitors
  if (!(await hasValidAccessCookie(req))) {
    return NextResponse.json({ error: 'Access code required' }, { status: 401 })
  }

  // Request size limit (intake body + optional image)
  const contentLength = req.headers.get('content-length')
  if (contentLength && parseInt(contentLength) > 10_000_000) {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }

  let description: string
  let material: string
  let referenceImage: File | null = null

  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    description = (formData.get('description') as string) || ''
    material = (formData.get('material') as string) || 'pa12'
    referenceImage = formData.get('reference_image') as File | null
  } else {
    let body: { description?: string; material?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    description = body.description || ''
    material = body.material || 'pa12'
  }

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

  // Validate and store reference image if provided
  let referenceImagePath: string | null = null
  if (referenceImage && referenceImage.size > 0) {
    if (referenceImage.size > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: `Image too large (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)` }, { status: 400 })
    }
    if (!ALLOWED_IMAGE_TYPES.includes(referenceImage.type)) {
      return NextResponse.json({ error: `Invalid image type. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}` }, { status: 400 })
    }
  }

  const db = getDb()
  const orderId = nanoid(21)
  const now = Date.now()

  // Store reference image if provided
  if (referenceImage && referenceImage.size > 0) {
    const artifactsDir = process.env.ARTIFACTS_DIR || '/artifacts'
    const orderDir = path.join(artifactsDir, orderId)
    if (!fs.existsSync(orderDir)) {
      fs.mkdirSync(orderDir, { recursive: true })
    }
    const ext = referenceImage.name.split('.').pop() || 'jpg'
    const filePath = path.join(orderDir, `reference.${ext}`)
    const buffer = Buffer.from(await referenceImage.arrayBuffer())
    fs.writeFileSync(filePath, buffer)
    referenceImagePath = path.join(artifactsDir, orderId, `reference.${ext}`)
  }

  db.prepare(`
    INSERT INTO orders (id, state, description, material, reference_image_path, created_at, updated_at)
    VALUES (?, 'intake', ?, ?, ?, ?, ?)
  `).run(orderId, description.trim(), material, referenceImagePath, now, now)

  // Call Hermes /v1/runs to start the agentic pipeline
  const runInput = `New order for Hermaquette manufacturing service.
Order ID: ${orderId}
Description: ${description.trim()}
Material: ${material}
${referenceImagePath ? `Reference image: ${referenceImagePath}` : ''}
Please process this order: generate concept images, get customer approval, then produce a 3D model and quote.`

  let runId: string | null = null
  try {
    const runRes = await fetch(`${HERMES_URL}/v1/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HERMES_KEY}`,
      },
      body: JSON.stringify({ input: runInput }),
      signal: AbortSignal.timeout(10_000),
    })
    if (runRes.ok) {
      const runData = await runRes.json() as { run_id: string }
      runId = runData.run_id
      db.prepare('UPDATE orders SET run_id = ?, updated_at = ? WHERE id = ?')
        .run(runId, now, orderId)
    } else {
      db.prepare("UPDATE orders SET state = 'error', error_msg = ?, updated_at = ? WHERE id = ?")
        .run(`Hermes gateway HTTP ${runRes.status}`, now, orderId)
      db.prepare("INSERT INTO events (order_id, stage, event, message, data, created_at) VALUES (?, 'orchestrator', 'error', ?, ?, ?)")
        .run(orderId, 'Hermes agent unavailable — please retry', JSON.stringify({ error: `HTTP ${runRes.status}` }), now)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    db.prepare("UPDATE orders SET state = 'error', error_msg = ?, updated_at = ? WHERE id = ?")
      .run(`Hermes gateway unreachable: ${msg}`, now, orderId)
    db.prepare("INSERT INTO events (order_id, stage, event, message, data, created_at) VALUES (?, 'orchestrator', 'error', ?, ?, ?)")
      .run(orderId, 'Hermes agent unavailable — please retry', JSON.stringify({ error: msg }), now)
  }

  db.prepare("INSERT INTO events (order_id, stage, event, message, data, created_at) VALUES (?, 'orchestrator', 'started', ?, ?, ?)")
    .run(orderId, 'Hermaquette is analyzing your request', JSON.stringify({ agent: 'Hermaquette', run_id: runId }), now)

  return NextResponse.json({ id: orderId, state: 'intake', run_id: runId }, { status: 201 })
}
