#!/usr/bin/env node
/**
 * tracking-qa skill script (minimal — B5)
 *
 * Post-delivery quality assurance. Checks tracking status and performs
 * a QA comparison if a delivery photo is available.
 *
 * B5: never-auto-send is guaranteed by absence of any send/transmit code.
 * Any mismatch drafts a reprint/refund action as pending_approval only.
 *
 * Usage: node run.js <orderId>
 * Output: JSON to stdout
 * Exit: 0 on success, 1 on fatal error
 */
import { getDb, emitEvent, writeDelegation } from '../_shared/db.js'
import { nanoid } from 'nanoid'

const orderId = process.argv[2]
if (!orderId) {
  console.error(JSON.stringify({ error: 'orderId required' }))
  process.exit(1)
}

const db = getDb()
const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
if (!order) {
  console.error(JSON.stringify({ error: `Order ${orderId} not found` }))
  process.exit(1)
}

// Get spec for comparison reference
const spec = db.prepare('SELECT * FROM spec WHERE order_id = ?').get(orderId)
const parentRunId = process.env.HERMES_RUN_ID || ''

// Write delegation started for follow-up child (first action)
writeDelegation(db, orderId, parentRunId, 'followup', 'started')

// Tracking status (stub — no live vendor API in demo)
const trackingResult = {
  tracking_status: 'pending',
  carrier: null,
  tracking_number: null,
  estimated_delivery: null,
  delivery_photo_url: null,
}

emitEvent(db, orderId, 'tracking-qa', 'tracking_checked',
  'Follow-up agent checked order tracking', trackingResult)

// QA result — no delivery photo available in demo
const result = {
  status: 'qa_skipped',
  tracking_status: trackingResult.tracking_status,
  qa_result: null,
  draft_action: null,
  notes: 'No delivery photo available for QA comparison.',
}

// IMPORTANT: If there were a mismatch, we would write to reprint_refund_draft
// with status='pending_approval' and NO send path. This is structurally enforced:
// there is no email/HTTP-send code in this script.
// B5: never-auto-send is guaranteed by absence of any send/transmit code.

writeDelegation(db, orderId, parentRunId, 'followup', 'completed')

emitEvent(db, orderId, 'tracking-qa', 'followup_complete',
  'Follow-up QA complete', result)

console.log(JSON.stringify({ status: 'ok', ...result }))
process.exit(0)
