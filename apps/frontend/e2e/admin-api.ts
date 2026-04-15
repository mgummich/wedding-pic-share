import type { APIRequestContext, APIResponse } from '@playwright/test'
import { expect } from '@playwright/test'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000'

function findCookiePair(setCookieHeader: string | undefined, cookieName: string): string | null {
  const match = setCookieHeader?.match(new RegExp(`${cookieName}=[^;]+`))
  return match?.[0] ?? null
}

function getSessionCookiePair(setCookieHeader: string | undefined): string {
  const sessionCookie = findCookiePair(setCookieHeader, 'session')
  if (!sessionCookie) throw new Error('No session cookie in login response')
  return sessionCookie
}

export async function loginAdminAndGetSessionCookie(request: APIRequestContext): Promise<string> {
  const loginRes = await request.post(`${API_URL}/api/v1/admin/login`, {
    data: {
      username: process.env.ADMIN_USERNAME ?? 'admin',
      password: process.env.ADMIN_PASSWORD ?? 'admin-local-dev',
    },
  })
  expect(loginRes.ok()).toBeTruthy()
  return getSessionCookiePair(loginRes.headers()['set-cookie'])
}

export async function fetchAdminCsrfToken(
  request: APIRequestContext,
  options?: { sessionCookie?: string }
): Promise<{ token: string; csrfCookie: string | null }> {
  const csrfRes = await request.get(`${API_URL}/api/v1/admin/csrf`, {
    headers: options?.sessionCookie ? { cookie: options.sessionCookie } : undefined,
  })
  expect(csrfRes.ok()).toBeTruthy()
  const csrfBody = await csrfRes.json() as { csrfToken?: unknown }
  if (typeof csrfBody.csrfToken !== 'string' || csrfBody.csrfToken.length < 8) {
    throw new Error('Invalid CSRF token response')
  }
  return {
    token: csrfBody.csrfToken,
    csrfCookie: findCookiePair(csrfRes.headers()['set-cookie'], '_csrf'),
  }
}

export async function adminPostWithCsrf(
  request: APIRequestContext,
  path: string,
  options: {
    data: unknown
    sessionCookie?: string
  }
): Promise<APIResponse> {
  const csrf = await fetchAdminCsrfToken(request, { sessionCookie: options.sessionCookie })
  const headers: Record<string, string> = {
    'x-csrf-token': csrf.token,
  }
  if (options.sessionCookie) {
    const cookiePairs = [options.sessionCookie, csrf.csrfCookie].filter((value): value is string => Boolean(value))
    headers.cookie = cookiePairs.join('; ')
  }
  return request.post(`${API_URL}${path}`, {
    headers,
    data: options.data,
  })
}

export async function adminPatchWithCsrf(
  request: APIRequestContext,
  path: string,
  options: {
    data: unknown
    sessionCookie?: string
  }
): Promise<APIResponse> {
  const csrf = await fetchAdminCsrfToken(request, { sessionCookie: options.sessionCookie })
  const headers: Record<string, string> = {
    'x-csrf-token': csrf.token,
  }
  if (options.sessionCookie) {
    const cookiePairs = [options.sessionCookie, csrf.csrfCookie].filter((value): value is string => Boolean(value))
    headers.cookie = cookiePairs.join('; ')
  }
  return request.patch(`${API_URL}${path}`, {
    headers,
    data: options.data,
  })
}
