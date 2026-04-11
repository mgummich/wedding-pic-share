import { type Page, type Locator } from '@playwright/test'

export class AdminDashboardPage {
  readonly heading: Locator
  readonly newGalleryLink: Locator
  readonly logoutButton: Locator
  readonly emptyState: Locator

  constructor(private page: Page) {
    this.heading = page.getByRole('heading', { name: 'Galerien' })
    this.newGalleryLink = page.getByRole('link', { name: 'Neu' })
    this.logoutButton = page.getByTitle('Abmelden')
    this.emptyState = page.getByText(/noch keine galerien/i)
  }

  async goto() {
    await this.page.goto('/admin')
  }

  galleryCard(name: string) {
    return this.page.getByText(name).first()
  }

  moderateButton(galleryName: string) {
    return this.page
      .locator('div', { has: this.page.getByText(galleryName) })
      .getByRole('link', { name: 'Moderieren' })
  }

  settingsButton(galleryName: string) {
    return this.page
      .locator('div', { has: this.page.getByText(galleryName) })
      .getByRole('link', { name: 'Einstellungen' })
  }
}
