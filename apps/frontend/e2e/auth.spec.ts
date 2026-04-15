import { test, expect } from './fixtures'
import { LoginPage } from './pages/LoginPage'

const USERNAME = process.env.ADMIN_USERNAME ?? 'admin'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin-local-dev'

test.describe('Admin Auth', () => {
  test('login page renders form fields', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await expect(loginPage.usernameInput).toBeVisible()
    await expect(loginPage.passwordInput).toBeVisible()
    await expect(loginPage.submitButton).toBeVisible()
  })

  test('wrong credentials show error message', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.login(USERNAME, 'falsches-passwort-xyz')
    await expect(loginPage.errorMessage).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('correct credentials redirect to dashboard', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.login(USERNAME, PASSWORD)
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Galerien' })).toBeVisible()
  })

  // Uses a fresh login (not the shared adminPage fixture) so the global
  // setup session remains valid for subsequent tests in other spec files.
  test('logout clears session and redirects to login', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.login(USERNAME, PASSWORD)
    await expect(page).toHaveURL(/\/admin$/)

    await page.getByRole('button', { name: 'Abmelden' }).click()
    await expect(page).toHaveURL(/\/admin\/login/)

    // Verify session is gone: navigating to /admin redirects to login again
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test.fixme('repeated bad passwords show the account lockout message', async ({ page }) => {
    // Requires an isolated admin account to avoid polluting shared E2E state.
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    const lockoutUsername = `lockout-e2e-${Date.now()}`

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await loginPage.login(lockoutUsername, 'falsches-passwort-xyz')
    }

    await expect(page.locator('form').getByText(/zu viele fehlversuche/i)).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/login/)
  })
})
