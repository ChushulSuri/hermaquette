/**
 * fal.ai spend ledger and budget guard.
 * Hard cap: FAL_BUDGET_USD (default $10).
 * Dev budget: FAL_DEV_BUDGET_USD (default $7) — use during build, reserve rest for demo.
 * Persisted to FAL_SPEND_FILE (default /tmp/fal_spend.json or process.cwd()/artifacts/fal_spend.json).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

class BudgetExhaustedError extends Error {
  constructor(msg) { super(msg); this.name = 'BudgetExhaustedError' }
}

function getSpendFile() {
  return process.env.FAL_SPEND_FILE ||
    (process.env.ARTIFACTS_DIR ? `${process.env.ARTIFACTS_DIR}/fal_spend.json` : '/tmp/fal_spend.json')
}

function loadSpend() {
  try {
    return JSON.parse(readFileSync(getSpendFile(), 'utf8'))
  } catch {
    return { total_usd: 0, entries: [] }
  }
}

function saveSpend(data) {
  const file = getSpendFile()
  try { mkdirSync(dirname(file), { recursive: true }) } catch {}
  writeFileSync(file, JSON.stringify(data, null, 2))
}

export function getCurrentSpend() {
  return loadSpend().total_usd
}

export function recordSpend(amount_usd, model_used, order_id = null) {
  const data = loadSpend()
  data.total_usd = (data.total_usd || 0) + amount_usd
  data.entries.push({ amount_usd, model_used, order_id, ts: new Date().toISOString() })
  saveSpend(data)
}

export function checkBudget(estimated_cost_usd = 0) {
  const cap = parseFloat(process.env.FAL_BUDGET_USD || '10')
  const devCap = parseFloat(process.env.FAL_DEV_BUDGET_USD || '7')
  const activeCap = process.env.DEMO_MODE === 'true' ? cap : devCap
  const current = getCurrentSpend()
  const remaining = activeCap - current

  if (current + estimated_cost_usd > activeCap) {
    return {
      allowed: false,
      remaining,
      current,
      cap: activeCap,
      reason: `Budget exhausted: $${current.toFixed(3)} spent, $${activeCap} cap, need $${estimated_cost_usd.toFixed(3)}`
    }
  }
  return { allowed: true, remaining, current, cap: activeCap }
}

export function resetSpend() {
  saveSpend({ total_usd: 0, entries: [] })
}

export { BudgetExhaustedError }
