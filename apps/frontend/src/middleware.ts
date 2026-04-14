import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const backendUrl = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  const isAdmin = req.nextUrl.pathname.startsWith('/admin')
  const isLogin = req.nextUrl.pathname === '/admin/login'
  const isSetup = req.nextUrl.pathname === '/setup'
  const isSingleGalleryRoute = ['/', '/upload', '/slideshow'].includes(req.nextUrl.pathname)
  const hasSession = req.cookies.has('session')

  if (isAdmin && !isLogin && !hasSession) {
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }

  if (process.env.SINGLE_GALLERY_MODE === 'true' && isSingleGalleryRoute) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/g/active`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })

      if (res.ok) {
        const body = await res.json() as { slug?: string }
        if (body.slug) {
          const pathname = req.nextUrl.pathname === '/'
            ? `/g/${body.slug}`
            : `/g/${body.slug}${req.nextUrl.pathname}`
          return NextResponse.rewrite(new URL(pathname, req.url))
        }
      }
    } catch {
      // Fail open and continue to the normal route tree.
    }
  }

  if (isSetup) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/setup/status`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })

      if (res.ok) {
        const body = await res.json() as { setupRequired?: boolean }
        if (body.setupRequired === false) {
          return NextResponse.redirect(new URL('/admin/login', req.url))
        }
      }
    } catch {
      // Fail open so setup isn't blocked by transient backend issues.
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/upload', '/slideshow', '/admin/:path*', '/setup'],
}
