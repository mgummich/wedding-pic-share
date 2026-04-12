import { test, expect } from '@playwright/test'

test.describe('Setup Guard', () => {
  test('visiting /setup after setup redirects to /admin/login', async ({ page }) => {
    await page.goto('/setup')

    await expect(page).toHaveURL(/\/admin\/login/)
  })
})
