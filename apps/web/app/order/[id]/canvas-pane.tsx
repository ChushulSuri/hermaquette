'use client'

import { ConceptGallery } from './concept-gallery'
import { ModelViewerSection } from './model-viewer-section'
import { MoneyCard } from './money-card'
import { PayButton } from './pay-button'
import { VendorApprovalPanel } from './vendor-approval'

interface Spec {
  dfm_report?: Record<string, unknown>
  glb_path?: string
}

interface Ledger {
  vendor_cost_cents?: number
  service_fee_cents?: number
  revenue_cents?: number
  gross_margin_pre_fees_cents?: number
  lead_time_days?: number
  quote_source?: string
  currency?: string
  stripe_payment_status?: string
}

interface CanvasPaneProps {
  orderId: string
  orderState: string
  badge: { label: string; color: string; description: string }
  spec?: Spec
  ledger?: Ledger
  conceptImages: Array<{ id: string; url: string }>
  dfmReport?: Record<string, unknown>
  glbUrl?: string
  spendCapCents: number
}

export function CanvasPane({
  orderId,
  orderState,
  badge,
  spec,
  ledger,
  conceptImages,
  dfmReport,
  glbUrl,
  spendCapCents,
}: CanvasPaneProps) {
  const showViewer = ['preview', 'manufacturable', 'quote', 'paid', 'checkout_pending_approval', 'checkout_approved', 'geometry_pending'].includes(orderState)
  const showConceptGallery = (orderState === 'concept' || orderState === 'geometry_pending') && conceptImages.length > 0
  const showMoneyCard = ledger && ['quote', 'paid', 'checkout_pending_approval', 'checkout_approved'].includes(orderState)
  const showPayButton = orderState === 'quote' && ledger
  const showVendorApproval = orderState === 'paid' && ledger

  return (
    <div className="p-4 md:p-6">
      {/* State badge */}
      <div className="flex items-center justify-end mb-4">
        <div className={`px-4 py-2 rounded-full text-sm font-semibold ${badge.color}`}>
          {badge.label}
        </div>
      </div>

      {/* Concept Gallery */}
      {showConceptGallery && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-3">
            <span className="text-purple-400">Hermes generated</span> concept directions
          </h2>
          <p className="text-sm text-gray-400 mb-4">
            Select the direction that best captures the full-3D figure you want.
            No hard price yet — indicative range based on complexity.
          </p>
          <ConceptGallery orderId={orderId} images={conceptImages} />
        </div>
      )}

      {/* 3D Preview */}
      {showViewer && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">
              <span className="text-purple-400">Hermes built</span> the 3D figure
            </h2>
            <div className="flex gap-2">
              {orderState === 'preview' && (
                <span className="text-xs bg-indigo-900 border border-indigo-600 px-2 py-1 rounded text-indigo-200">
                  Preview — DFM pending
                </span>
              )}
              {orderState === 'manufacturable' && (
                <span className="text-xs bg-green-900 border border-green-600 px-2 py-1 rounded text-green-200">
                  Manufacturable ✓
                </span>
              )}
            </div>
          </div>

          <ModelViewerSection glbUrl={glbUrl} orderId={orderId} orderState={orderState} />

          {dfmReport && (
            <div className={`mt-3 p-3 rounded-lg text-sm ${dfmReport.status === 'PASS' || dfmReport.status === 'PASS_AFTER_FIX' ? 'bg-green-900/40 border border-green-800' : 'bg-yellow-900/40 border border-yellow-800'}`}>
              <p className="font-medium text-white">
                DFM {dfmReport.status === 'PASS_AFTER_FIX' ? 'PASS (after auto-fix)' : dfmReport.status as string}
              </p>
              {dfmReport.explanation && <p className="text-gray-300 mt-1 text-xs">{dfmReport.explanation as string}</p>}
              {dfmReport.material_recommendation && (
                <p className="text-gray-400 mt-1 text-xs">
                  Material recommendation: <span className="text-amber-300 uppercase font-medium">{dfmReport.material_recommendation as string}</span>
                  {dfmReport.material_reason ? ` — ${dfmReport.material_reason as string}` : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Money Card */}
      {showMoneyCard && ledger && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-3">
            <span className="text-purple-400">Hermes priced</span> the order
          </h2>
          <MoneyCard ledger={ledger} />
        </div>
      )}

      {/* Pay Button */}
      {showPayButton && ledger && (
        <div className="mb-6">
          <PayButton orderId={orderId} revenueCents={ledger.revenue_cents!} currency={ledger.currency} />
        </div>
      )}

      {/* Vendor Approval */}
      {showVendorApproval && ledger && (
        <div className="mb-6">
          <VendorApprovalPanel orderId={orderId} currency={ledger.currency} vendorCostCents={ledger.vendor_cost_cents} spendCapCents={spendCapCents} />
        </div>
      )}
    </div>
  )
}
