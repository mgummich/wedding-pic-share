import { test, expect } from '@playwright/test'
import { randomBytes } from 'crypto'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { GalleryPage } from './pages/GalleryPage'
import { LightboxPage } from './pages/LightboxPage'
import { UploadPage } from './pages/UploadPage'
import { TEST_GALLERY_NAME, TEST_GALLERY_SLUG, TINY_PNG } from './global-setup'

/** Returns a unique PNG buffer so backend duplicate-detection never blocks. */
function uniquePng() {
  return Buffer.concat([TINY_PNG, randomBytes(8)])
}

function tinyMp4() {
  const dir = mkdtempSync(join(tmpdir(), 'wps-e2e-video-'))
  const file = join(dir, 'tiny.mp4')
  const color = `0x${randomBytes(3).toString('hex')}`

  try {
    execFileSync('ffmpeg', [
      '-f', 'lavfi',
      '-i', `color=c=${color}:s=16x16:d=1`,
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',
      file,
    ], { stdio: 'ignore' })

    return readFileSync(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000'

test.describe('Guest Gallery', () => {
  test('gallery page loads with gallery name', async ({ page }) => {
    const gallery = new GalleryPage(page)
    await gallery.goto(TEST_GALLERY_SLUG)
    await expect(page).toHaveURL(`/g/${TEST_GALLERY_SLUG}`)
    await expect(page.getByRole('navigation', { name: /galerie-navigation/i })).toContainText(TEST_GALLERY_NAME)
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

test.describe('Guest Nav', () => {
  test('nav bar is visible on gallery page', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    await expect(page.getByRole('navigation', { name: /galerie-navigation/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /galerie/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /hochladen/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /slideshow/i })).toBeVisible()
  })

  test('upload link in nav navigates to upload page', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    await page.getByRole('link', { name: /hochladen/i }).click()
    await expect(page).toHaveURL(`/g/${TEST_GALLERY_SLUG}/upload`)
  })

  test('slideshow link in nav navigates to slideshow page', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    await page.getByRole('link', { name: /slideshow/i }).click()
    await expect(page).toHaveURL(`/g/${TEST_GALLERY_SLUG}/slideshow`)
  })
})

test.describe('Guest Gallery Lightbox', () => {
  test.beforeEach(async ({ request }) => {
    const loginRes = await request.post(`${API_URL}/api/v1/admin/login`, {
      data: {
        username: process.env.ADMIN_USERNAME ?? 'admin',
        password: process.env.ADMIN_PASSWORD ?? 'admin-local-dev',
      },
    })
    expect(loginRes.ok()).toBeTruthy()

    const cookie = loginRes.headers()['set-cookie']
    expect(cookie).toBeTruthy()

    const uploadRes = await request.post(`${API_URL}/api/v1/g/${TEST_GALLERY_SLUG}/upload`, {
      multipart: {
        file: {
          name: 'lightbox-test.png',
          mimeType: 'image/png',
          buffer: uniquePng(),
        },
      },
    })

    expect(uploadRes.ok()).toBeTruthy()
    const uploaded = await uploadRes.json()
    await request.post(`${API_URL}/api/v1/admin/photos/batch`, {
      headers: { cookie: cookie! },
      data: { action: 'approve', photoIds: [uploaded.id] },
    })
  })

  test('clicking a photo opens the lightbox', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    const lightbox = new LightboxPage(page)
    const firstPhoto = page.getByRole('button', { name: /gallery photo|photo by/i }).first()
    await expect(firstPhoto).toBeVisible()
    await firstPhoto.click()
    await expect(lightbox.overlay).toBeVisible()
    await expect(lightbox.closeButton).toBeVisible()
  })

  test('close button dismisses the lightbox', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    const lightbox = new LightboxPage(page)
    await page.getByRole('button', { name: /gallery photo|photo by/i }).first().click()
    await expect(lightbox.overlay).toBeVisible()
    await lightbox.closeButton.click()
    await expect(lightbox.overlay).not.toBeVisible()
  })

  test('Escape key closes the lightbox', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    const lightbox = new LightboxPage(page)
    await page.getByRole('button', { name: /gallery photo|photo by/i }).first().click()
    await expect(lightbox.overlay).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(lightbox.overlay).not.toBeVisible()
  })

  test('video items open in the lightbox with native controls', async ({ page, request }) => {
    const loginRes = await request.post(`${API_URL}/api/v1/admin/login`, {
      data: {
        username: process.env.ADMIN_USERNAME ?? 'admin',
        password: process.env.ADMIN_PASSWORD ?? 'admin-local-dev',
      },
    })
    expect(loginRes.ok()).toBeTruthy()

    const cookie = loginRes.headers()['set-cookie']
    expect(cookie).toBeTruthy()

    const uploadRes = await request.post(`${API_URL}/api/v1/g/${TEST_GALLERY_SLUG}/upload`, {
      multipart: {
        file: {
          name: 'lightbox-test.mp4',
          mimeType: 'video/mp4',
          buffer: tinyMp4(),
        },
      },
    })

    expect(uploadRes.ok()).toBeTruthy()
    const uploaded = await uploadRes.json()
    await request.post(`${API_URL}/api/v1/admin/photos/batch`, {
      headers: { cookie: cookie! },
      data: { action: 'approve', photoIds: [uploaded.id] },
    })

    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    const lightbox = new LightboxPage(page)
    const firstPhoto = page.getByRole('button', { name: /gallery photo|photo by/i }).first()
    await expect(firstPhoto).toBeVisible()
    await firstPhoto.click()

    await expect(lightbox.overlay).toBeVisible()
    await expect(lightbox.video).toBeVisible()
    await expect(lightbox.video).toHaveAttribute('controls', '')
  })
})

test.describe('Guest Download', () => {
  test('download button is not visible when allowGuestDownload is false', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    await expect(page.getByRole('link', { name: /alle fotos herunterladen/i })).not.toBeAttached()
  })
})
