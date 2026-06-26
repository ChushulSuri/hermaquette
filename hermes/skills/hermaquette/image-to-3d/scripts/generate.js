#!/usr/bin/env node
/**
 * image-to-3d skill script.
 * Called by the Hermes skill runner with input JSON on stdin.
 * Outputs result JSON to stdout.
 */
import { generate3d, BudgetExhaustedError } from '../../../../packages/image3d/adapter.js'
import { checkBudget, getCurrentSpend } from '../../../../packages/image3d/budget.js'

async function main() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk

  const { image_url, order_id, dry_run = false } = JSON.parse(input)

  if (!image_url) {
    console.error(JSON.stringify({ error: 'image_url required' }))
    process.exit(1)
  }

  // Pre-call budget check
  const budget = checkBudget(0.80) // Conservative estimate for both passes
  if (!budget.allowed) {
    console.log(JSON.stringify({
      status: 'budget_exhausted',
      error: budget.reason,
      current_spend: budget.current,
      cap: budget.cap,
    }))
    process.exit(0)
  }

  try {
    const result = await generate3d(image_url, {
      orderId: order_id,
      dry_run,
    })
    console.log(JSON.stringify({ status: 'ok', ...result }))
  } catch (err) {
    if (err instanceof BudgetExhaustedError) {
      console.log(JSON.stringify({ status: 'budget_exhausted', error: err.message }))
    } else {
      console.log(JSON.stringify({ status: 'error', error: err.message }))
    }
    process.exit(0)
  }
}

main()
