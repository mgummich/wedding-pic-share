import type { Metadata } from 'next'
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
        <AdminLocaleProvider>{children}</AdminLocaleProvider>
      </body>
    </html>
  )
}
