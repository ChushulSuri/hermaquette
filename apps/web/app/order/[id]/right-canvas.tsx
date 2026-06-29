'use client'

import { ReactNode } from 'react'

interface RightCanvasProps {
  orderId: string
  orderState: string
  badge: { label: string; color: string; description: string }
  children: ReactNode
}

export function RightCanvas({ orderId, orderState, badge, children }: RightCanvasProps) {
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      {/* State badge */}
      <div className="flex items-center justify-end mb-4">
        <div className={`px-4 py-2 rounded-full text-sm font-semibold ${badge.color}`}>
          {badge.label}
        </div>
      </div>

      {children}
    </div>
  )
}
