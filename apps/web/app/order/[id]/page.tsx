import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db'
import { SplitView } from './split-view'
import { ChatPane } from './chat-pane'
import { CanvasPane } from './canvas-pane'

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

export const dynamic = 'force-dynamic'
export const revalidate = 0

function getStateBadge(state: string): { label: string; color: string; description: string } {
  const badges: Record<string, { label: string; color: string; description: string }> = {
    intake: { label: 'Intake', color: 'bg-gray-700', description: 'Processing your request...' },
    research_done: { label: 'Researching', color: 'bg-blue-900', description: 'Hermes researched references' },
    concept: { label: 'Concept', color: 'bg-purple-900 border border-purple-500', description: 'Select a concept direction' },
    geometry_pending: { label: 'Building...', color: 'bg-indigo-900', description: 'Hermes is building geometry' },
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

  const events = db.prepare(`
    SELECT id, stage, event, message, data, created_at
    FROM events WHERE order_id=? ORDER BY created_at DESC LIMIT 30
  `).all(params.id) as Array<{ id: number; stage: string; event: string; message: string; data: string; created_at: number }>

  // Query the latest images_ready event DIRECTLY — it can be hundreds of events
  // back (gpt-5.5 streaming emits ~280 message.delta rows), so the LIMIT 30
  // activity window above would miss it and the concept gallery would never show.
  const conceptEvent = db.prepare(`
    SELECT data FROM events WHERE order_id=? AND event='images_ready'
    ORDER BY created_at DESC LIMIT 1
  `).get(params.id) as { data: string } | undefined
  let conceptImages: Array<{ id: string; url: string }> = []
  if (conceptEvent?.data) {
    try { conceptImages = JSON.parse(conceptEvent.data).images || [] } catch { /* */ }
  }

  let dfmReport: Record<string, unknown> | undefined
  if (spec?.dfm_report) {
    try { dfmReport = typeof spec.dfm_report === 'string' ? JSON.parse(spec.dfm_report) : spec.dfm_report as Record<string, unknown> } catch { /* */ }
  }

  // Shipping address is collected at the quote stage (before payment). Query the
  // captured address (if any) to gate the Pay button and show it at the end.
  const shipEvent = db.prepare(`
    SELECT data FROM events WHERE order_id=? AND event='ship_to_captured'
    ORDER BY created_at DESC LIMIT 1
  `).get(params.id) as { data: string } | undefined
  let shipToAddress: Record<string, string> | undefined
  if (shipEvent?.data) { try { shipToAddress = JSON.parse(shipEvent.data) } catch { /* */ } }
  const shipToCaptured = !!shipToAddress

  // NVIDIA Nemotron's customer-facing DFM explanation lives in the dfm_pass event.
  const dfmEvent = db.prepare(`
    SELECT data FROM events WHERE order_id=? AND event IN ('dfm_pass','dfm_pass_after_fix')
    ORDER BY created_at DESC LIMIT 1
  `).get(params.id) as { data: string } | undefined
  let dfmExplanation: string | undefined
  if (dfmEvent?.data) {
    try { const e = JSON.parse(dfmEvent.data).dfm_explanation; if (e) dfmExplanation = String(e) } catch { /* */ }
  }

  const badge = getStateBadge(order.state)
  const showViewer = ['preview', 'manufacturable', 'quote', 'paid', 'checkout_pending_approval', 'checkout_approved', 'geometry_pending'].includes(order.state)
  const showConceptGallery = (order.state === 'concept' || order.state === 'geometry_pending') && conceptImages.length > 0
  const showMoneyCard = ledger && ['quote', 'paid', 'checkout_pending_approval', 'checkout_approved'].includes(order.state)
  const showPayButton = order.state === 'quote' && ledger
  const showVendorApproval = order.state === 'paid' && ledger

  const artifactsDir = process.env.ARTIFACTS_DIR || '/artifacts'
  let glbUrl: string | undefined
  if (spec?.glb_path && typeof spec.glb_path === 'string') {
    glbUrl = `/api/artifacts${spec.glb_path.startsWith(artifactsDir) ? spec.glb_path.slice(artifactsDir.length) : spec.glb_path}`
  }

  const leftPane = (
    <div className="flex flex-col h-full">
      {/* Description card */}
      <div className="px-4 pt-4 pb-2">
        <div className="rounded-xl p-3" style={{ background: '#111118', border: '1px solid #1e1e2e' }}>
          <p className="text-xs mb-1" style={{ color: '#5a5a72' }}>Object description</p>
          <p className="text-sm" style={{ color: '#f0f0f8' }}>{order.description}</p>
          <div className="flex gap-4 mt-1.5 text-xs" style={{ color: '#5a5a72' }}>
            <span>Material: <span className="uppercase" style={{ color: '#9090a8' }}>{spec?.material || order.material}</span></span>
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
      </div>

      {/* Chat feed */}
      <div className="flex-1 min-h-0">
        <ChatPane
          orderId={params.id}
          initialEvents={events.slice().reverse()}
          orderState={order.state}
        />
      </div>
    </div>
  )

  const rightPane = (
    <CanvasPane
      orderId={params.id}
      orderState={order.state}
      badge={badge}
      spec={spec}
      ledger={ledger}
      conceptImages={conceptImages}
      dfmReport={dfmReport}
      dfmExplanation={dfmExplanation}
      glbUrl={glbUrl}
      spendCapCents={parseInt(process.env.SPEND_CAP_CENTS || '5000')}
      shipToCaptured={shipToCaptured}
      shipToAddress={shipToAddress}
    />
  )

  return (
    <SplitView
      orderId={params.id}
      orderState={order.state}
      left={leftPane}
      right={rightPane}
    />
  )
}
