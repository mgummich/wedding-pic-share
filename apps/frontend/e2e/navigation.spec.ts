import { test, expect, type APIRequestContext } from '@playwright/test'
import { TEST_GALLERY_NAME, TEST_GALLERY_SLUG } from './global-setup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000'

async function setActiveGalleryForRootRewrites(request: APIRequestContext) {
  const loginRes = await request.post(`${API_URL}/api/v1/admin/login`, {
    data: {
      username: process.env.ADMIN_USERNAME ?? 'admin',
      password: process.env.ADMIN_PASSWORD ?? 'admin-local-dev',
    },
  })
  expect(loginRes.ok()).toBeTruthy()
  const cookie = loginRes.headers()['set-cookie']
  expect(cookie).toBeTruthy()

  const listRes = await request.get(`${API_URL}/api/v1/admin/galleries`, {
    headers: { cookie: cookie! },
  })
  expect(listRes.ok()).toBeTruthy()
  const weddings = await listRes.json() as Array<{
    galleries: Array<{ id: string; slug: string }>
  }>
  const gallery = weddings
    .flatMap((wedding) => wedding.galleries)
    .find((entry) => entry.slug === TEST_GALLERY_SLUG)
  expect(gallery).toBeTruthy()

  const patchRes = await request.patch(`${API_URL}/api/v1/admin/galleries/${gallery!.id}`, {
    headers: { cookie: cookie! },
    data: { isActive: true },
  })
  expect(patchRes.ok()).toBeTruthy()
}

test.describe('Navigation & Redirects', () => {
  test('root / redirects to /admin', async ({ page }) => {
    test.skip(process.env.SINGLE_GALLERY_MODE === 'true', 'Single-gallery mode can rewrite root to the active gallery')
    await page.goto('/')
    await expect(page).toHaveURL(/\/admin/)
  })

  test('unauthenticated /admin redirects to /admin/login', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('unknown gallery slug shows not-found page', async ({ page }) => {
    await page.goto('/g/diese-galerie-gibt-es-nicht-xyz')
    // Next.js notFound() renders a 404 page
    await expect(page.getByRole('heading', { name: /404|nicht gefunden/i })).toBeVisible()
  })

  test('upload page for unknown gallery slug shows not-found', async ({ page }) => {
    await page.goto('/g/diese-galerie-gibt-es-nicht-xyz/upload')
    await expect(page.getByRole('heading', { name: /404|nicht gefunden/i })).toBeVisible()
  })
})

test.describe('Single Gallery Mode Rewrites', () => {
  test.skip(process.env.SINGLE_GALLERY_MODE !== 'true', 'Requires SINGLE_GALLERY_MODE=true')

  test.beforeEach(async ({ request }) => {
    await setActiveGalleryForRootRewrites(request)
  })

  test('root / renders the active gallery content', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('navigation', { name: /galerie-navigation/i })).toContainText(TEST_GALLERY_NAME)
  })

  test('/upload rewrites to active gallery upload content', async ({ page }) => {
    await page.goto('/upload')
    await expect(page).toHaveURL('/upload')
    await expect(page.getByRole('heading', { name: /fotos hochladen/i })).toBeVisible()
    await expect(page.getByRole('navigation', { name: /galerie-navigation/i })).toContainText(TEST_GALLERY_NAME)
  })

  test('/slideshow rewrites to active gallery slideshow content', async ({ page }) => {
    await page.goto('/slideshow')
    await expect(page).toHaveURL('/slideshow')
    await expect(page.getByRole('navigation', { name: /galerie-navigation/i })).toContainText(TEST_GALLERY_NAME)
  })
})
