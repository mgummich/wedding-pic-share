import { test, expect } from './fixtures'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { TEST_GALLERY_NAME, TEST_GALLERY_SLUG } from './global-setup'
import { GallerySettingsPage } from './pages/GallerySettingsPage'

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
})
