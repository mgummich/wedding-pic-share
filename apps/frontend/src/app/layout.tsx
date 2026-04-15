import type { Metadata } from 'next'
import { DM_Sans, Playfair_Display } from 'next/font/google'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import './globals.css'
import { AdminLocaleProvider } from '@/components/AdminLocaleContext'
import { ToastProvider } from '@/components/ToastProvider'
import { resolveHtmlLang } from '@/lib/htmlLang'

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
})

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
})

export const metadata: Metadata = {
  title: 'Wedding Pic Share',
  description: 'Share your wedding moments',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let htmlLang = 'de'
  try {
    const cookieStore = await cookies()
    htmlLang = resolveHtmlLang(cookieStore.get('NEXT_LOCALE')?.value)
  } catch {
    htmlLang = 'de'
  }

  return (
    <html lang={htmlLang}>
      <body className={`${dmSans.variable} ${playfairDisplay.variable} font-sans antialiased`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-card focus:bg-surface-card focus:px-4 focus:py-2 focus:text-sm focus:text-text-primary focus:shadow-lg"
        >
          Skip to main content
        </a>
        <AdminLocaleProvider>
          <ToastProvider>
            <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-text-muted">Loading…</div>}>
              <div id="main-content" tabIndex={-1}>
                {children}
              </div>
            </Suspense>
          </ToastProvider>
        </AdminLocaleProvider>
      </body>
    </html>
  )
}
