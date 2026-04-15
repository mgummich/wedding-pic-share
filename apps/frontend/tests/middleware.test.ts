import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { middleware } from '../src/middleware'

function createRequest(pathname: string, opts: { hasSession?: boolean; cookieHeader?: string } = {}): NextRequest {
  const url = `http://localhost${pathname}`
  return {
    url,
    nextUrl: new URL(url),
    cookies: {
      has: vi.fn().mockReturnValue(Boolean(opts.hasSession)),
    },
    headers: {
      get: vi.fn((name: string) => {
        if (name.toLowerCase() === 'cookie') return opts.cookieHeader ?? ''
        return null
      }),
    },
  } as unknown as NextRequest
}

describe('middleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('redirects to login when backend session check fails for admin routes', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network down'))

    const response = await middleware(createRequest('/admin', { hasSession: true }))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/admin/login')
  })

  it('allows admin route when session check succeeds', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }))

    const response = await middleware(createRequest('/admin', { hasSession: true }))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })
})
