import { randomBytes } from 'crypto'
import { test, expect } from './fixtures'
import { UploadPage } from './pages/UploadPage'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { ModerationPage } from './pages/ModerationPage'
import { TEST_GALLERY_NAME, TEST_GALLERY_SLUG, TINY_PNG } from './global-setup'

function uniquePng() {
  return Buffer.concat([TINY_PNG, randomBytes(8)])
}

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000'

test.describe('Happy Path Smoke', () => {
  test('guest can upload a photo', async ({ page }) => {
    const upload = new UploadPage(page)
    await upload.goto(TEST_GALLERY_SLUG)

    await upload.fileInput.setInputFiles({
      name: `smoke-${Date.now()}.png`,
      mimeType: 'image/png',
      buffer: uniquePng(),
    })
    await upload.submitButton.click()

    await expect(upload.successHeading).toBeVisible({ timeout: 15_000 })
  })

  test('admin can approve a pending upload', async ({ adminPage }) => {
    const uploadRes = await adminPage.request.post(`${API_URL}/api/v1/g/${TEST_GALLERY_SLUG}/upload`, {
      multipart: {
        file: {
          name: `smoke-moderation-${Date.now()}.png`,
          mimeType: 'image/png',
          buffer: uniquePng(),
        },
      },
    })
    expect(uploadRes.ok()).toBeTruthy()

    const dashboard = new AdminDashboardPage(adminPage)
    const moderation = new ModerationPage(adminPage)

    await dashboard.goto()
    await dashboard.moderateButton(TEST_GALLERY_NAME).click()

    const approveButtons = adminPage.getByRole('button', { name: /^Freigeben$/ })
    const before = await approveButtons.count()
    expect(before).toBeGreaterThan(0)

    await moderation.firstApproveButton().click()

    if (before === 1) {
      await expect(moderation.emptyState).toBeVisible()
    } else {
      await expect
        .poll(async () => approveButtons.count(), { timeout: 10_000 })
        .toBe(before - 1)
    }
  })
})
