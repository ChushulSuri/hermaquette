import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db'
import { ConceptGallery } from './concept-gallery'
import { ModelViewerSection } from './model-viewer-section'
import { MoneyCard } from './money-card'
import { PayButton } from './pay-button'
import { VendorApprovalPanel } from './vendor-approval'
import { EventTimeline } from './event-timeline'

interface PageProps {
  params: { id: string }
  searchParams: { cancelled?: string }
}

interface Order {
  id: string
  state: string
  description: string
  material: string
  error_msg?: string
}

interface Spec {
  dfm_status?: string
  dfm_report?: string | Record<string, unknown>
  glb_path?: string
  material?: string
  dimensions_mm?: string
  quote_status?: string
  ship_to_status?: string
  provenance?: string | Array<{ url: string; title: string }>
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

interface VendorOrder {
  status?: string
  vendor_cost_cents?: number
  spend_cap_cents?: number
  issuing_card_id?: string
  spend_path?: string
  executed?: number
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

function getStateBadge(state: string): { label: string; color: string; description: string } {
  const badges: Record<string, { label: string; color: string; description: string }> = {
    intake: { label: 'Intake', color: 'bg-gray-700', description: 'Processing your request...' },
    research_done: { label: 'Researching', color: 'bg-blue-900', description: 'Hermes researched references' },
    concept: { label: 'Concept', color: 'bg-purple-900 border border-purple-500', description: 'Select a concept direction' },
    concept_approved: { label: 'Building...', color: 'bg-indigo-900', description: 'Hermes is building geometry' },
    preview: { label: 'Preview', color: 'bg-indigo-800 border border-indigo-400', description: 'Interactive 3D preview' },
    manufacturable: { label: 'Manufacturable ✓', color: 'bg-green-900 border border-green-500', description: 'DFM passed — getting quote' },
    quote: { label: 'Quote', color: 'bg-amber-900 border border-amber-500', description: 'Ready to purchase' },
    paid: { label: 'Paid ✓ (TEST)', color: 'bg-green-800 border border-green-400', description: 'Payment confirmed (TEST MODE)' },
    checkout_pending_approval: { label: 'Awaiting Approval', color: 'bg-yellow-900 border border-yellow-500', description: 'Hermes awaits human approval' },
    checkout_approved: { label: 'Checkout Approved', color: 'bg-teal-900 border border-teal-500', description: 'Governed checkout approved' },
    blocked: { label: 'Blocked', color: 'bg-red-900 border border-red-600', description: 'Cannot manufacture in V1' },
    error: { label: 'Error', color: 'bg-red-900', description: 'Pipeline error occurred' },
  }
  return badges[state] || { label: state, color: 'bg-gray-700', description: '' }
}

export default function OrderPage({ params, searchParams }: PageProps) {
  const db = getDb()

  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(params.id) as Order | undefined
  if (!order) notFound()

  const spec = db.prepare('SELECT * FROM spec WHERE order_id=?').get(params.id) as Spec | undefined
  const ledger = db.prepare('SELECT * FROM ledger WHERE order_id=?').get(params.id) as Ledger | undefined
  const vendorOrder = db.prepare('SELECT * FROM vendor_order WHERE order_id=? ORDER BY created_at DESC LIMIT 1').get(params.id) as VendorOrder | undefined

  const events = db.prepare(`
    SELECT id, stage, event, message, data, created_at
    FROM events WHERE order_id=? ORDER BY created_at DESC LIMIT 30
  `).all(params.id) as Array<{ id: number; stage: string; event: string; message: string; data: string; created_at: number }>

  // Extract concept images
  const conceptEvent = events.find(e => e.event === 'images_ready')
  let conceptImages: Array<{ id: string; url: string }> = []
  if (conceptEvent?.data) {
    try { conceptImages = JSON.parse(conceptEvent.data).images || [] } catch { /* */ }
  }

  // Parse DFM report
  let dfmReport: Record<string, unknown> | undefined
  if (spec?.dfm_report) {
    try { dfmReport = typeof spec.dfm_report === 'string' ? JSON.parse(spec.dfm_report) : spec.dfm_report as Record<string, unknown> } catch { /* */ }
  }

  const badge = getStateBadge(order.state)
  const showViewer = ['preview', 'manufacturable', 'quote', 'paid', 'checkout_pending_approval', 'checkout_approved'].includes(order.state)
  const showConceptGallery = order.state === 'concept' && conceptImages.length > 0
  const showMoneyCard = ledger && ['quote', 'paid', 'checkout_pending_approval', 'checkout_approved'].includes(order.state)
  const showPayButton = order.state === 'quote' && ledger
  const showVendorApproval = ['checkout_pending_approval'].includes(order.state) && vendorOrder

  // GLB URL
  const artifactsDir = process.env.ARTIFACTS_DIR || '/artifacts'
  let glbUrl: string | undefined
  if (spec?.glb_path && typeof spec.glb_path === 'string') {
    glbUrl = `/api/artifacts${spec.glb_path.startsWith(artifactsDir) ? spec.glb_path.slice(artifactsDir.length) : spec.glb_path}`
  }

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <a href="/" className="text-sm text-gray-500 hover:text-gray-300 mb-2 block">← New order</a>
          <h1 className="text-2xl font-bold text-white">Order <span className="font-mono text-purple-400 text-lg">{params.id.slice(0, 8)}…</span></h1>
        </div>
        <div className={`px-4 py-2 rounded-full text-sm font-semibold ${badge.color}`}>
          {badge.label}
        </div>
      </div>

      {/* Description */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
        <p className="text-sm text-gray-400 mb-1">Object description</p>
        <p className="text-white">{order.description}</p>
        <div className="flex gap-4 mt-2 text-xs text-gray-500">
          <span>Material: <span className="text-gray-300 uppercase">{spec?.material || order.material}</span></span>
          {spec?.dimensions_mm && (
            <span>Dims: {(() => {
              try {
                const d = JSON.parse(spec.dimensions_mm as string)
                return `${d.x}×${d.y}×${d.z}mm`
              } catch {
                return spec.dimensions_mm
              }
            })()}</span>
          )}
        </div>
      </div>

      {/* Cancelled notice */}
      {searchParams.cancelled && (
        <div className="bg-yellow-900/50 border border-yellow-700 rounded-xl p-4 mb-6 text-yellow-200 text-sm">
          Payment cancelled — you can try again below.
        </div>
      )}

      {/* Error / blocked */}
      {order.state === 'error' && (
        <div className="bg-red-900/50 border border-red-700 rounded-xl p-4 mb-6">
          <p className="text-red-300 font-semibold">Pipeline error</p>
          <p className="text-red-400 text-sm mt-1">{order.error_msg}</p>
        </div>
      )}
      {order.state === 'blocked' && (
        <div className="bg-red-900/50 border border-red-700 rounded-xl p-4 mb-6">
          <p className="text-red-300 font-semibold">Cannot manufacture in V1</p>
          <p className="text-red-400 text-sm mt-1">{order.error_msg || dfmReport?.reason as string || 'DFM blocked — object exceeds manufacturable parameters'}</p>
        </div>
      )}

      {/* Concept Gallery */}
      {showConceptGallery && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-3">
            <span className="text-purple-400">Hermes generated</span> concept directions
          </h2>
          <p className="text-sm text-gray-400 mb-4">
            Select the direction that best captures the front-facing relief you want.
            No hard price yet — indicative range based on complexity.
          </p>
          <ConceptGallery orderId={params.id} images={conceptImages} />
        </div>
      )}

      {/* 3D Preview */}
      {showViewer && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">
              <span className="text-purple-400">Hermes built</span> the 3D relief
            </h2>
            <div className="flex gap-2">
              {order.state === 'preview' && (
                <span className="text-xs bg-indigo-900 border border-indigo-600 px-2 py-1 rounded text-indigo-200">
                  Preview — DFM pending
                </span>
              )}
              {order.state === 'manufacturable' && (
                <span className="text-xs bg-green-900 border border-green-600 px-2 py-1 rounded text-green-200">
                  Manufacturable ✓
                </span>
              )}
            </div>
          </div>

          {glbUrl ? (
            <ModelViewerSection glbUrl={glbUrl} orderId={params.id} />
          ) : (
            <div className="bg-gray-900 border border-gray-700 rounded-xl h-40 flex items-center justify-center text-gray-500 text-sm">
              3D model generating...
            </div>
          )}

          {/* DFM result */}
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
          <PayButton orderId={params.id} revenueCents={ledger.revenue_cents!} currency={ledger.currency} />
        </div>
      )}

      {/* Paid confirmation */}
      {order.state === 'paid' && (
        <div className="bg-green-900/30 border border-green-700 rounded-xl p-4 mb-6">
          <p className="text-green-300 font-semibold">✓ Payment confirmed (TEST MODE)</p>
          <p className="text-green-400 text-sm mt-1">
            Hermes is evaluating governed vendor checkout. Stripe test card used — no real charge.
          </p>
        </div>
      )}

      {/* Vendor Approval */}
      {showVendorApproval && vendorOrder && (
        <div className="mb-6">
          <VendorApprovalPanel orderId={params.id} currency={ledger?.currency} vendorOrder={vendorOrder} />
        </div>
      )}

      {/* Checkout Approved */}
      {order.state === 'checkout_approved' && vendorOrder && (
        <div className="bg-teal-900/30 border border-teal-700 rounded-xl p-6 mb-6">
          <p className="text-teal-300 font-semibold mb-2">✓ Governed checkout approved</p>
          {vendorOrder.spend_path === 'issuing' && vendorOrder.issuing_card_id ? (
            <p className="text-teal-400 text-sm">
              <span className="text-amber-300 font-mono">Stripe Issuing</span> virtual card issued (cap: ${((vendorOrder.spend_cap_cents || 5000) / 100).toFixed(2)}).
              Card ID: <span className="font-mono text-xs">{vendorOrder.issuing_card_id.slice(0, 16)}…</span>
              <br />
              <span className="text-gray-400">Card is NEVER charged — execution gated until shipping address provided.</span>
            </p>
          ) : (
            <p className="text-teal-400 text-sm">
              Governed approval record created (SQLite path). Execution gated until shipping address provided.
            </p>
          )}
          <div className="mt-4 p-3 bg-teal-900/50 rounded-lg border border-teal-800">
            <p className="text-white font-medium text-sm">Want the totem?</p>
            <p className="text-gray-300 text-sm mt-1">
              Send a shipping address to the Nous/Hermes team and Hermaquette will 3D-print and ship this totem.
              This checkout can go live — no code changes needed.
            </p>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            One-off personal gift · Not for resale · No affiliation or endorsement claimed
          </p>
        </div>
      )}

      {/* Event Timeline */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wide">Hermes activity log</h2>
        <EventTimeline events={events} orderId={params.id} />
      </div>

      {/* Disclaimer */}
      <div className="mt-8 p-4 bg-gray-900/50 rounded-xl border border-gray-800 text-xs text-gray-500">
        <strong className="text-gray-400">Honesty box:</strong>{' '}
        All Stripe charges are in TEST MODE (card 4242 4242 4242 4242).
        Gross margin shown is pre-fees, not profit.
        One-off personal gift — not for resale — no affiliation or endorsement with any depicted brand claimed.
        {ledger?.quote_source === 'manual' && ' Quote is from a recorded capture (recording insurance) — not a live Sculpteo API quote.'}
      </div>
    </main>
  )
}
