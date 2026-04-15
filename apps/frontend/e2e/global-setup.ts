import { chromium, type FullConfig } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

export const ADMIN_STATE_FILE = path.join(__dirname, '.auth/admin.json')
export const TEST_GALLERY_SLUG = 'e2e-galerie'
export const TEST_WEDDING_SLUG = 'e2e-wedding'
export const TEST_GALLERY_NAME = 'E2E Galerie'
// 1×1 px black PNG — smallest valid image accepted by sharp
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

export default async function globalSetup(_config: FullConfig) {
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
  const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:4000'
  const username = process.env.ADMIN_USERNAME ?? 'admin'
  const password = process.env.ADMIN_PASSWORD ?? 'admin-local-dev'

  fs.mkdirSync(path.dirname(ADMIN_STATE_FILE), { recursive: true })

  // 1. Login directly via API to get session cookie
  //    (avoids cross-port cookie issues in browser global setup)
  const loginRes = await fetch(`${apiUrl}/api/v1/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!loginRes.ok) {
    throw new Error(`Admin login failed: ${loginRes.status} ${await loginRes.text()}`)
  }
  const setCookieHeader = loginRes.headers.get('set-cookie') ?? ''
  const sessionMatch = setCookieHeader.match(/session=([^;]+)/)
  if (!sessionMatch) throw new Error('No session cookie in login response')
  const sessionValue = sessionMatch[1]

  // 2. Inject cookie into a browser context so storageState is saved
  //    Cookie must be visible to both localhost:3000 (middleware) and localhost:4000 (API),
  //    so we add it for both explicitly.
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: baseUrl })
  await context.addCookies([
    {
      name: 'session',
      value: sessionValue,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ])
  await context.storageState({ path: ADMIN_STATE_FILE })

  // 3. Create test gallery (idempotent — 409 = already exists)
  const page = await context.newPage()
  const csrfRes = await page.request.get(`${apiUrl}/api/v1/admin/csrf`)
  if (!csrfRes.ok()) {
    throw new Error(`CSRF fetch failed: ${csrfRes.status()} ${await csrfRes.text()}`)
  }
  const csrfBody = await csrfRes.json() as { csrfToken?: unknown }
  if (typeof csrfBody.csrfToken !== 'string' || csrfBody.csrfToken.length < 8) {
    throw new Error('Invalid CSRF token response during E2E setup')
  }

  const res = await page.request.post(`${apiUrl}/api/v1/admin/galleries`, {
    headers: {
      'x-csrf-token': csrfBody.csrfToken,
    },
    data: {
      weddingName: 'E2E Wedding',
      weddingSlug: TEST_WEDDING_SLUG,
      galleryName: TEST_GALLERY_NAME,
      gallerySlug: TEST_GALLERY_SLUG,
      description: 'Created by E2E global setup',
      moderationMode: 'MANUAL',
      guestNameMode: 'OPTIONAL',
    },
  })
  if (!res.ok() && res.status() !== 409) {
    throw new Error(`Gallery setup failed: ${res.status()} ${await res.text()}`)
  }

  await browser.close()
}
