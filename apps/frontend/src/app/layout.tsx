import type { Metadata } from 'next'
import { Suspense } from 'react'
import './globals.css'
import { AdminLocaleProvider } from '@/components/AdminLocaleContext'

export const metadata: Metadata = {
  title: 'Wedding Pic Share',
  description: 'Share your wedding moments',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="font-sans antialiased">
        <AdminLocaleProvider>
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-text-muted">Loading…</div>}>
            {children}
          </Suspense>
        </AdminLocaleProvider>
      </body>
    </html>
  )
}
