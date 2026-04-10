import { test, expect } from '@playwright/test'

const GALLERY_SLUG = process.env.E2E_GALLERY_SLUG ?? 'e2e-test'

test.describe('Guest upload flow', () => {
  test('gallery page loads and shows upload button', async ({ page }) => {
    await page.goto(`/g/${GALLERY_SLUG}`)
    await expect(page.getByRole('link', { name: /moment festhalten/i })).toBeVisible()
  })

  test('upload page shows file input', async ({ page }) => {
    await page.goto(`/g/${GALLERY_SLUG}/upload`)
    await expect(page.getByLabel(/fotos/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /hochladen/i })).toBeVisible()
  })

  test('shows validation error when submitting empty form', async ({ page }) => {
    await page.goto(`/g/${GALLERY_SLUG}/upload`)
    await page.click('button[type="submit"]')
    await expect(page.getByText(/bitte.*datei/i)).toBeVisible()
  })
})
