'use client'

import { ReactNode } from 'react'

interface SplitViewProps {
  orderId: string
  orderState: string
  left: ReactNode
  right: ReactNode
}

export function SplitView({ orderId, orderState, left, right }: SplitViewProps) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: '#1e1e2e', background: '#0a0a0f' }}>
        <a href="/" className="text-sm hover:opacity-80 transition-opacity" style={{ color: '#5a5a72' }}>
          &larr; Hermaquette
        </a>
        <span className="text-xs font-mono" style={{ color: '#5a5a72' }}>
          {orderId.slice(0, 8)}&hellip;
        </span>
      </header>

      {/* Two-pane grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[380px_1fr] overflow-hidden">
        {/* Left pane — chat activity feed */}
        <aside className="border-r overflow-y-auto"
          style={{ borderColor: '#1e1e2e', background: '#0a0a0f' }}>
          {left}
        </aside>

        {/* Right pane — progressive canvas */}
        <main className="overflow-y-auto" style={{ background: '#0d0d1a' }}>
          {right}
        </main>
      </div>
    </div>
  )
}
