import { test, expect } from './fixtures'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { ModerationPage } from './pages/ModerationPage'
import { TEST_GALLERY_SLUG, TEST_GALLERY_NAME, TINY_PNG } from './global-setup'
import { randomBytes } from 'crypto'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000'

/**
 * Upload a photo as guest directly via API.
 * Each call uses a unique buffer (random suffix after IEND) so SHA256 differs
 * and the backend's duplicate-detection never returns 409.
 */
async function uploadPendingPhoto(request: { post: Function }) {
  // Append 8 random bytes after the PNG IEND marker — PNG decoders ignore
  // trailing data, but the SHA256 hash changes, bypassing duplicate detection.
  const uniqueBuffer = Buffer.concat([TINY_PNG, randomBytes(8)])
  const res = await request.post(`${API_URL}/api/v1/g/${TEST_GALLERY_SLUG}/upload`, {
    multipart: {
      file: {
        name: 'moderation-test.png',
        mimeType: 'image/png',
        buffer: uniqueBuffer,
      },
    },
  })
  if (!res.ok()) {
    throw new Error(`Upload failed: ${res.status()} ${await res.text()}`)
  }
}

test.describe('Moderation', () => {
  test.beforeEach(async ({ adminPage }) => {
    await uploadPendingPhoto(adminPage.request)
  })

  test('pending photo appears on moderation page', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.moderateButton(TEST_GALLERY_NAME).click()

    const modPage = new ModerationPage(adminPage)
    await expect(modPage.pendingCount).toBeVisible()
  })

  test('approving a photo removes it from the moderation queue', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.moderateButton(TEST_GALLERY_NAME).click()

    const modPage = new ModerationPage(adminPage)
    await expect(modPage.pendingCount).toBeVisible()

    const countText = await modPage.pendingCount.textContent()
    const initialCount = parseInt(countText ?? '0')

    await modPage.firstApproveButton().click()

    if (initialCount === 1) {
      await expect(modPage.emptyState).toBeVisible()
    } else {
      await expect(adminPage.getByText(`${initialCount - 1} ausstehend`)).toBeVisible()
    }
  })

  test('rejecting a photo removes it from the moderation queue', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.moderateButton(TEST_GALLERY_NAME).click()

    const modPage = new ModerationPage(adminPage)
    await expect(modPage.pendingCount).toBeVisible()

    const countText = await modPage.pendingCount.textContent()
    const initialCount = parseInt(countText ?? '0')

    await modPage.firstRejectButton().click()

    if (initialCount === 1) {
      await expect(modPage.emptyState).toBeVisible()
    } else {
      await expect(adminPage.getByText(`${initialCount - 1} ausstehend`)).toBeVisible()
    }
  })

  test('"Alle freigeben" clears the entire queue', async ({ adminPage }) => {
    const dashboard = new AdminDashboardPage(adminPage)
    await dashboard.goto()
    await dashboard.moderateButton(TEST_GALLERY_NAME).click()

    const modPage = new ModerationPage(adminPage)
    await expect(modPage.pendingCount).toBeVisible()
    await modPage.approveAllButton.click()
    await expect(modPage.emptyState).toBeVisible()
  })
})
