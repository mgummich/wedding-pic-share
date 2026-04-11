import { test, expect } from './fixtures'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { TEST_GALLERY_NAME, TEST_GALLERY_SLUG } from './global-setup'
import { GallerySettingsPage } from './pages/GallerySettingsPage'
import { NewGalleryPage } from './pages/NewGalleryPage'

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
    // The test gallery created in global-setup has slug TEST_GALLERY_SLUG;
    // attempting to create another with the same slug triggers a 409.
    const newPage = new NewGalleryPage(adminPage)
    await newPage.goto()

    await newPage.weddingNameInput.fill('Duplicate Wedding')
    await newPage.weddingSlugInput.fill('duplicate-wedding')
    await newPage.galleryNameInput.fill('Duplicate Gallery')
    await newPage.gallerySlugInput.fill(TEST_GALLERY_SLUG) // already exists
    await newPage.submitButton.click()

    await expect(newPage.errorMessage).toBeVisible()
    await expect(adminPage).toHaveURL(/\/admin\/galleries\/new/)
  })
})
