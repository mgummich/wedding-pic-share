import { test, expect } from '@playwright/test'
import { randomBytes } from 'crypto'
import { GalleryPage } from './pages/GalleryPage'
import { UploadPage } from './pages/UploadPage'
import { TEST_GALLERY_SLUG, TINY_PNG } from './global-setup'

/** Returns a unique PNG buffer so backend duplicate-detection never blocks. */
function uniquePng() {
  return Buffer.concat([TINY_PNG, randomBytes(8)])
}

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000'

test.describe('Guest Gallery', () => {
  test('gallery page loads with gallery name', async ({ page }) => {
    const gallery = new GalleryPage(page)
    await gallery.goto(TEST_GALLERY_SLUG)
    await expect(page).toHaveURL(`/g/${TEST_GALLERY_SLUG}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('upload button is visible on gallery page', async ({ page }) => {
    const gallery = new GalleryPage(page)
    await gallery.goto(TEST_GALLERY_SLUG)
    await expect(gallery.uploadButton).toBeVisible()
  })

  test('upload button navigates to upload page', async ({ page }) => {
    const gallery = new GalleryPage(page)
    await gallery.goto(TEST_GALLERY_SLUG)
    await gallery.uploadButton.click()
    await expect(page).toHaveURL(`/g/${TEST_GALLERY_SLUG}/upload`)
  })

  test('slideshow page loads', async ({ page }) => {
    const gallery = new GalleryPage(page)
    await gallery.gotoSlideshow(TEST_GALLERY_SLUG)
    await expect(page).toHaveURL(`/g/${TEST_GALLERY_SLUG}/slideshow`)
    // Shows either a photo or the empty state message
    const emptyState = page.getByText(/noch keine fotos freigegeben/i)
    const photo = page.locator('img, video').first()
    await expect(emptyState.or(photo)).toBeVisible()
  })
})

test.describe('Guest Upload', () => {
  test('upload page shows file input and submit button', async ({ page }) => {
    const upload = new UploadPage(page)
    await upload.goto(TEST_GALLERY_SLUG)
    await expect(upload.fileInput).toBeAttached()
    await expect(upload.submitButton).toBeVisible()
  })

  test('submitting empty form shows validation error', async ({ page }) => {
    const upload = new UploadPage(page)
    await upload.goto(TEST_GALLERY_SLUG)
    await upload.submitButton.click()
    await expect(upload.formError(/bitte.*datei/i)).toBeVisible()
  })

  test('back link navigates to gallery', async ({ page }) => {
    const upload = new UploadPage(page)
    await upload.goto(TEST_GALLERY_SLUG)
    await page.getByRole('link').filter({ has: page.locator('svg') }).first().click()
    await expect(page).toHaveURL(`/g/${TEST_GALLERY_SLUG}`)
  })

  test('uploading a valid image shows success screen', async ({ page }) => {
    const upload = new UploadPage(page)
    await upload.goto(TEST_GALLERY_SLUG)

    await upload.fileInput.setInputFiles({
      name: 'test-photo.png',
      mimeType: 'image/png',
      buffer: uniquePng(),
    })

    await upload.submitButton.click()
    await expect(upload.successHeading).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/deine fotos wurden eingereicht/i)).toBeVisible()
  })

  test('after successful upload, "weitere Fotos" button resets form', async ({ page }) => {
    const upload = new UploadPage(page)
    await upload.goto(TEST_GALLERY_SLUG)

    await upload.fileInput.setInputFiles({
      name: 'test-photo-2.png',
      mimeType: 'image/png',
      buffer: uniquePng(),
    })
    await upload.submitButton.click()
    await expect(upload.successHeading).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /weitere fotos/i }).click()
    await expect(upload.submitButton).toBeVisible()
  })
})
