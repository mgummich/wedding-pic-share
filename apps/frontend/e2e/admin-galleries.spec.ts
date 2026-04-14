import { test, expect } from './fixtures'
import { randomBytes } from 'crypto'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { LightboxPage } from './pages/LightboxPage'
import { TEST_GALLERY_NAME, TEST_GALLERY_SLUG, TEST_WEDDING_SLUG, TINY_PNG } from './global-setup'
import { GallerySettingsPage } from './pages/GallerySettingsPage'
import { NewGalleryPage } from './pages/NewGalleryPage'

function uniquePng() {
  return Buffer.concat([TINY_PNG, randomBytes(8)])
}

test.describe('Admin Dashboard', () => {
  test('shows gallery list after login', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await expect(dashboard.heading).toBeVisible()
    await expect(dashboard.newGalleryLink).toBeVisible()
  })

  test('test gallery created in setup is visible', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await expect(dashboard.galleryCard(TEST_GALLERY_NAME)).toBeVisible()
  })

  test('moderation link for test gallery navigates to moderation page', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.moderateButton(TEST_GALLERY_NAME).click()
    await expect(adminPage).toHaveURL(/\/admin\/galleries\/.+\/moderate/)
  })

  test('moderation page renders for test gallery', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.moderateButton(TEST_GALLERY_NAME).click()
    // Either shows pending photos or the empty state
    const emptyState = adminPage.getByText('Alles erledigt!')
    const pendingCount = adminPage.getByText(/\d+ ausstehend/)
    await expect(emptyState.or(pendingCount)).toBeVisible()
  })

  test('unauthenticated access to moderation page redirects to login', async ({ page }) => {
    await page.goto('/admin/galleries/some-id/moderate')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('"Neu" link navigates to new gallery form', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.newGalleryLink.click()
    await expect(adminPage).toHaveURL(/\/admin\/galleries\/new/)
  })

  test('settings icon navigates to gallery settings page', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.settingsButton(TEST_GALLERY_NAME).click()
    await expect(adminPage).toHaveURL(/\/admin\/galleries\/.+(?<!\/moderate)$/)
    const settingsPage = new GallerySettingsPage(adminPage)
    await expect(settingsPage.nameInput).toBeVisible()
  })

  test('unauthenticated access to settings page redirects to login', async ({ page }) => {
    await page.goto('/admin/galleries/some-id')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('gallery settings: updating the name saves successfully', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.settingsButton(TEST_GALLERY_NAME).click()

    const settingsPage = new GallerySettingsPage(adminPage)
    await expect(settingsPage.nameInput).toBeVisible()

    await settingsPage.nameInput.fill(TEST_GALLERY_NAME) // keep same name — just verify save works
    await settingsPage.saveButton.click()
    await expect(settingsPage.savedMessage).toBeVisible()
  })

  test('sidebar is visible on admin dashboard', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await expect(dashboard.sidebar).toBeVisible()
  })

  test('test gallery appears in sidebar', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await expect(dashboard.sidebarGallery(TEST_GALLERY_NAME)).toBeVisible()
  })

  test('clicking gallery in sidebar navigates to settings', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.sidebarGallery(TEST_GALLERY_NAME).click()
    await expect(adminPage).toHaveURL(/\/admin\/galleries\/.+(?<!\/moderate)$/)
  })

  test('sidebar is not shown on login page', async ({ page }) => {
    await page.goto('/admin/login')
    await expect(page.locator('aside')).toHaveCount(0)
  })

  test('clicking a moderation photo opens the lightbox', async ({ adminPage, request }) => {
    const uploadRes = await request.post(`${process.env.E2E_API_URL ?? 'http://localhost:4000'}/api/v1/g/${TEST_GALLERY_SLUG}/upload`, {
      multipart: {
        file: {
          name: 'moderation-lightbox.png',
          mimeType: 'image/png',
          buffer: uniquePng(),
        },
      },
    })
    expect(uploadRes.ok()).toBeTruthy()

    const dashboard = new AdminDashboardPage(adminPage)
    const lightbox = new LightboxPage(adminPage)

    await dashboard.goto()
    await dashboard.moderateButton(TEST_GALLERY_NAME).click()

    const firstPhoto = adminPage.getByRole('button', { name: /foto vergrößern/i }).first()
    await expect(firstPhoto).toBeVisible()
    await firstPhoto.click()
    await expect(lightbox.overlay).toBeVisible()
    await expect(lightbox.closeButton).toBeVisible()
  })
})

test.describe('New Gallery', () => {
  // Use a unique slug per run so parallel/re-runs don't conflict with each other
  // or with the persistent E2E gallery created in global-setup.
  const uniqueSuffix = () => Date.now().toString(36)

  test('new gallery form renders required fields', async ({ adminPage }) => {
    const newPage = new NewGalleryPage(adminPage)
    await newPage.goto()
    await expect(newPage.weddingNameInput).toBeVisible()
    await expect(newPage.galleryNameInput).toBeVisible()
    await expect(newPage.submitButton).toBeVisible()
  })

  test('creating a gallery navigates back to dashboard and shows the new gallery', async ({ adminPage }) => {
    const suffix = uniqueSuffix()
    const galleryName = `E2E Neu ${suffix}`
    const newPage = new NewGalleryPage(adminPage)
    await newPage.goto()

    await newPage.weddingNameInput.fill(`E2E Wedding ${suffix}`)
    await newPage.galleryNameInput.fill(galleryName)
    await newPage.submitButton.click()

    await expect(adminPage).toHaveURL(/\/admin$/)
    await expect(adminPage.getByText(galleryName)).toBeVisible()
  })

  test('duplicate slug shows error message', async ({ adminPage }) => {
    // Gallery slugs are unique per wedding, so reuse both the existing wedding slug
    // and gallery slug created during global setup to trigger the expected 409.
    const newPage = new NewGalleryPage(adminPage)
    await newPage.goto()

    await newPage.weddingNameInput.fill('Duplicate Wedding')
    await newPage.weddingSlugInput.fill(TEST_WEDDING_SLUG)
    await newPage.galleryNameInput.fill('Duplicate Gallery')
    await newPage.gallerySlugInput.fill(TEST_GALLERY_SLUG)
    await newPage.submitButton.click()

    await expect(newPage.errorMessage).toBeVisible()
    await expect(adminPage).toHaveURL(/\/admin\/galleries\/new/)
  })
})

test.describe('Gallery Settings Actions', () => {
  test('QR-Code PNG and SVG download links are visible', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.sidebarGallery(TEST_GALLERY_NAME).click()
    await adminPage.waitForURL(/\/admin\/galleries\/.+(?<!\/moderate)$/)

    const settings = new GallerySettingsPage(adminPage)
    await expect(settings.qrDownloadPng).toBeVisible()
    await expect(settings.qrDownloadSvg).toBeVisible()
  })

  test('ZIP export button is visible', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.sidebarGallery(TEST_GALLERY_NAME).click()
    await adminPage.waitForURL(/\/admin\/galleries\/.+(?<!\/moderate)$/)

    const settings = new GallerySettingsPage(adminPage)
    await expect(settings.exportButton).toBeVisible()
  })

  test('QR-Code PNG link has correct href', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.sidebarGallery(TEST_GALLERY_NAME).click()
    await adminPage.waitForURL(/\/admin\/galleries\/.+(?<!\/moderate)$/)

    const settings = new GallerySettingsPage(adminPage)
    await expect(settings.qrDownloadPng).toHaveAttribute('href', new RegExp(`/g/${TEST_GALLERY_SLUG}/qr`))
  })

  test('admin bulk upload on MANUAL gallery sends files to moderation', async ({ adminPage }) => {
    const listRes = await adminPage.request.get(`${process.env.E2E_API_URL ?? 'http://localhost:4000'}/api/v1/admin/galleries`)
    expect(listRes.ok()).toBeTruthy()
    const weddings = await listRes.json() as Array<{
      galleries: Array<{ id: string; slug: string }>
    }>
    const gallery = weddings.flatMap((wedding) => wedding.galleries)
      .find((entry) => entry.slug === TEST_GALLERY_SLUG)
    expect(gallery).toBeTruthy()

    const settings = new GallerySettingsPage(adminPage)
    await settings.goto(gallery!.id)
    await expect(settings.nameInput).toBeVisible()
    await settings.adminUploadInput.setInputFiles([
      {
        name: `manual-1-${Date.now()}.png`,
        mimeType: 'image/png',
        buffer: uniquePng(),
      },
      {
        name: `manual-2-${Date.now()}.png`,
        mimeType: 'image/png',
        buffer: uniquePng(),
      },
    ])

    await settings.adminUploadStartButton.click()
    await expect(adminPage.getByText(/upload abgeschlossen: .*in moderation/i)).toBeVisible({ timeout: 20_000 })
    await expect(settings.adminUploadQueue.getByText('In Moderation')).toHaveCount(2)
  })

  test('admin bulk upload on AUTO gallery marks files approved and updates approved section', async ({ adminPage }) => {
    const suffix = Date.now().toString(36)
    const createRes = await adminPage.request.post(`${process.env.E2E_API_URL ?? 'http://localhost:4000'}/api/v1/admin/galleries`, {
      data: {
        weddingName: `E2E Auto Wedding ${suffix}`,
        weddingSlug: `e2e-auto-wedding-${suffix}`,
        galleryName: `E2E Auto ${suffix}`,
        gallerySlug: `e2e-auto-${suffix}`,
        moderationMode: 'AUTO',
        guestNameMode: 'OPTIONAL',
      },
    })
    expect(createRes.ok()).toBeTruthy()
    const created = await createRes.json()

    const settings = new GallerySettingsPage(adminPage)
    await settings.goto(created.id as string)
    await expect(settings.nameInput).toBeVisible()

    await settings.adminUploadInput.setInputFiles([
      {
        name: `auto-${suffix}.png`,
        mimeType: 'image/png',
        buffer: uniquePng(),
      },
    ])

    await settings.adminUploadStartButton.click()
    await expect(adminPage.getByText(/upload abgeschlossen: 1 freigegeben/i)).toBeVisible({ timeout: 20_000 })
    await expect(settings.adminUploadQueue.getByText('Freigegeben')).toBeVisible()
    await expect(adminPage.getByRole('heading', { name: /Freigegebene Fotos \(\d+\)/ })).toBeVisible()
  })
})
