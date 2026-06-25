import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Hermaquette — Other agents move bits. We ship atoms.',
  description: 'Hermes-operated micro-manufacturing pipeline. Describe an object → get a validated 3D-printed part.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
