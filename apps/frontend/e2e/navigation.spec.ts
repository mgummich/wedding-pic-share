import { test, expect } from '@playwright/test'

test.describe('Navigation & Redirects', () => {
  test('root / redirects to /admin', async ({ page }) => {
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
