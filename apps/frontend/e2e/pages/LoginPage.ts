import { type Page, type Locator } from '@playwright/test'

export class LoginPage {
  readonly usernameInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly errorMessage: Locator

  constructor(private page: Page) {
    this.usernameInput = page.getByLabel('Benutzername')
    this.passwordInput = page.getByLabel('Passwort')
    this.submitButton = page.getByRole('button', { name: 'Anmelden' })
    this.errorMessage = page.getByText(/falscher benutzername/i)
  }

  async goto() {
    await this.page.goto('/admin/login')
  }

  async login(username: string, password: string) {
    await this.usernameInput.fill(username)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }
}
