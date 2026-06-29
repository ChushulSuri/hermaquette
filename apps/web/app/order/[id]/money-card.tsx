interface MoneyCardProps {
  ledger: {
    vendor_cost_cents?: number
    service_fee_cents?: number
    revenue_cents?: number
    gross_margin_pre_fees_cents?: number
    lead_time_days?: number
    quote_source?: string
    currency?: string
    stripe_payment_status?: string
  }
}

function cents(n: number | undefined, symbol: string) {
  if (!n) return `${symbol}0.00`
  return `${symbol}${(n / 100).toFixed(2)}`
}

export function MoneyCard({ ledger }: MoneyCardProps) {
  const isPaid = ledger.stripe_payment_status === 'paid'
  const isManual = ledger.quote_source === 'manual' || ledger.quote_source === 'cached'
  const currency = (ledger.currency || 'usd').toUpperCase()
  const symbol = currency === 'EUR' ? '€' : '$'

  return (
    <div className="bg-gray-900 border border-amber-800/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-amber-300">Quote Summary</h3>
        <div className="flex gap-2">
          <span className="text-xs bg-red-900/70 border border-red-700 px-2 py-0.5 rounded text-red-300 font-semibold">
            TEST MODE
          </span>
          {isManual && (
            <span className="text-xs bg-gray-800 border border-gray-600 px-2 py-0.5 rounded text-gray-400">
              recorded quote
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-gray-300">
          <span>Vendor cost (Slant3D)</span>
          <span className="font-mono">{cents(ledger.vendor_cost_cents, symbol)} <span className="text-gray-500 text-xs">{currency}</span></span>
        </div>
        <div className="flex justify-between text-gray-300">
          <span>Service fee (10%)</span>
          <span className="font-mono text-amber-300">{cents(ledger.service_fee_cents, symbol)}</span>
        </div>
        <div className="border-t border-gray-700 pt-2 flex justify-between font-semibold text-white">
          <span>Customer price</span>
          <span className="font-mono text-xl">{cents(ledger.revenue_cents, symbol)} <span className="font-normal text-sm text-gray-400">{currency}</span></span>
        </div>
        <div className="flex justify-between text-xs text-gray-500 pt-1">
          <span>Gross margin pre-fees</span>
          <span className="font-mono text-green-400">{cents(ledger.gross_margin_pre_fees_cents, symbol)}</span>
        </div>
        {ledger.lead_time_days && (
          <div className="flex justify-between text-xs text-gray-500">
            <span>Estimated lead time</span>
            <span>{ledger.lead_time_days} days</span>
          </div>
        )}
      </div>

      {isPaid && (
        <div className="mt-4 p-2 bg-green-900/30 border border-green-800 rounded text-xs text-green-300 text-center">
          ✓ Paid (TEST MODE) — Stripe session confirmed server-side
        </div>
      )}

      <p className="text-xs text-gray-600 mt-3">
        &quot;Gross margin pre-fees&quot; is revenue minus vendor cost. Not profit — Stripe fees and ops costs apply.
      </p>
    </div>
  )
}
