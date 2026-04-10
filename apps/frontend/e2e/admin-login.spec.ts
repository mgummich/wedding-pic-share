import { test, expect } from '@playwright/test'

test.describe('Admin login', () => {
  test('redirects to /admin/login when not authenticated', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('shows error on wrong credentials', async ({ page }) => {
    await page.goto('/admin/login')
    await page.fill('#username', 'admin')
    await page.fill('#password', 'wrongpassword')
    await page.click('button[type="submit"]')
    await expect(page.getByText(/falscher benutzername/i)).toBeVisible()
  })

  test('logs in with valid credentials and redirects to dashboard', async ({ page }) => {
    await page.goto('/admin/login')
    await page.fill('#username', process.env.ADMIN_USERNAME ?? 'admin')
    await page.fill('#password', process.env.ADMIN_PASSWORD ?? 'admin')
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/admin$/)
  })
})
