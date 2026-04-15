import { test, expect, type APIRequestContext } from '@playwright/test'
import { randomBytes } from 'crypto'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { GalleryPage } from './pages/GalleryPage'
import { LightboxPage } from './pages/LightboxPage'
import { UploadPage } from './pages/UploadPage'
import { TEST_GALLERY_NAME, TEST_GALLERY_SLUG, TINY_PNG } from './global-setup'
import { adminPostWithCsrf, loginAdminAndGetSessionCookie } from './admin-api'

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

async function approvePhoto(
  request: APIRequestContext,
  photoId: string,
  sessionCookie?: string
) {
  const approveRes = await adminPostWithCsrf(request, '/api/v1/admin/photos/batch', {
    sessionCookie,
    data: { action: 'approve', photoIds: [photoId] },
  })
  expect(approveRes.ok()).toBeTruthy()
}

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
    await gallery.uploadButton.evaluate((element) => {
      (element as HTMLElement).click()
    })
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

  test('approved videos open in lightbox with native controls', async ({ page, request }) => {
    const sessionCookie = await loginAdminAndGetSessionCookie(request)

    const uploadRes = await request.post(`${API_URL}/api/v1/g/${TEST_GALLERY_SLUG}/upload`, {
      multipart: {
        file: {
          name: 'inline-video-test.mp4',
          mimeType: 'video/mp4',
          buffer: tinyMp4(),
        },
      },
    })
    expect(uploadRes.ok()).toBeTruthy()
    const uploaded = await uploadRes.json()

    await approvePhoto(request, uploaded.id, sessionCookie)

    const gallery = new GalleryPage(page)
    await gallery.goto(TEST_GALLERY_SLUG)
    const videoCard = page.getByRole('button', { name: /video vergrößern|enlarge video/i }).first()
    await expect(videoCard).toBeVisible()
    await videoCard.click()
    await expect(page.locator('video[controls]').first()).toBeVisible()
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

    await upload.selectFiles({
      name: 'test-photo.png',
      mimeType: 'image/png',
      buffer: uniquePng(),
    })
    await expect(page.getByText('test-photo.png')).toBeVisible()

    await upload.submitButton.click()
    await expect(upload.successHeading).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/deine fotos wurden eingereicht/i)).toBeVisible()
  })

  test('transient 503 upload failure is auto-retried and succeeds', async ({ page, browserName }) => {
    const upload = new UploadPage(page)
    await upload.goto(TEST_GALLERY_SLUG)

    let attempts = 0
    await page.route(`**/api/v1/g/${TEST_GALLERY_SLUG}/upload`, async (route) => {
      attempts += 1
      if (attempts === 1) {
        await route.abort('failed')
        return
      }

      await route.continue()
    })

    await upload.selectFiles({
      name: 'test-photo-retry.png',
      mimeType: 'image/png',
      buffer: uniquePng(),
    })
    await expect(page.getByText('test-photo-retry.png')).toBeVisible()

    await upload.submitButton.click()
    await expect(upload.successHeading).toBeVisible({ timeout: 15_000 })
    if (browserName === 'chromium') {
      await expect
        .poll(() => attempts, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2)
    }
  })

  test('after successful upload, "weitere Fotos" button resets form', async ({ page }) => {
    const upload = new UploadPage(page)
    await upload.goto(TEST_GALLERY_SLUG)

    await upload.selectFiles({
      name: 'test-photo-2.png',
      mimeType: 'image/png',
      buffer: uniquePng(),
    })
    await expect(page.getByText('test-photo-2.png')).toBeVisible()
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
    const sessionCookie = await loginAdminAndGetSessionCookie(request)

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
    await approvePhoto(request, uploaded.id, sessionCookie)
  })

  test('clicking a photo opens the lightbox', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    const lightbox = new LightboxPage(page)
    const firstPhoto = page.getByRole('button', { name: /galeriefoto|gallery photo|foto von|photo by/i }).first()
    await expect(firstPhoto).toBeVisible()
    await firstPhoto.click()
    await expect(lightbox.overlay).toBeVisible()
    await expect(lightbox.closeButton).toBeVisible()
  })

  test('close button dismisses the lightbox', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    const lightbox = new LightboxPage(page)
    await page.getByRole('button', { name: /galeriefoto|gallery photo|foto von|photo by/i }).first().click()
    await expect(lightbox.overlay).toBeVisible()
    await lightbox.closeButton.evaluate((element) => {
      (element as HTMLElement).click()
    })
    await expect(lightbox.overlay).not.toBeVisible()
  })

  test('Escape key closes the lightbox', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    const lightbox = new LightboxPage(page)
    await page.getByRole('button', { name: /galeriefoto|gallery photo|foto von|photo by/i }).first().click()
    await expect(lightbox.overlay).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(lightbox.overlay).not.toBeVisible()
  })

  test('video items open in the lightbox with native controls', async ({ page, request }) => {
    const sessionCookie = await loginAdminAndGetSessionCookie(request)

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
    await approvePhoto(request, uploaded.id, sessionCookie)

    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    const lightbox = new LightboxPage(page)
    const expandVideo = page.getByRole('button', { name: /video vergrößern/i }).first()
    await expect(expandVideo).toBeVisible()
    await expandVideo.click()

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
