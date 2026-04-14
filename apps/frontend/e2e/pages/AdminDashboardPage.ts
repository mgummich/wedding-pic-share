import { expect, type Page, type Locator } from '@playwright/test'

export class AdminDashboardPage {
  readonly heading: Locator
  readonly newGalleryLink: Locator
  readonly logoutButton: Locator
  readonly emptyState: Locator
  readonly sidebar: Locator
  readonly sidebarToggleButton: Locator

  constructor(private page: Page) {
    this.heading = page.getByRole('heading', { name: 'Galerien' })
    this.sidebar = page.locator('aside')
    this.sidebarToggleButton = page.getByRole('button', {
      name: /seitenleiste öffnen|seitenleiste schließen/i,
    })
    this.newGalleryLink = this.sidebar.getByRole('link', { name: /neue galerie erstellen/i })
    this.logoutButton = this.sidebar.getByRole('button', { name: 'Abmelden' })
    this.emptyState = page.getByText(/noch keine galerien/i)
  }

  async goto() {
    await this.page.goto('/admin')
  }

  galleryListItem(name: string) {
    return this.page
      .locator('main div.bg-surface-card')
      .filter({ has: this.page.getByRole('heading', { name }) })
      .first()
  }

  galleryCard(name: string) {
    return this.galleryListItem(name)
  }

  rootActiveBadge(galleryName: string) {
    return this.galleryListItem(galleryName).getByText('Root aktiv')
  }

  async ensureSidebarOpen() {
    if (!(await this.sidebarToggleButton.isVisible())) return

    const label = (await this.sidebarToggleButton.getAttribute('aria-label')) ?? ''
    if (label.toLowerCase().includes('öffnen')) {
      await this.sidebarToggleButton.click()
    }
    await expect(this.sidebar).toBeVisible()
  }

  async clickNewGalleryLink() {
    await this.ensureSidebarOpen()
    await this.newGalleryLink.click()
  }

  sidebarGallery(name: string) {
    return this.sidebar.getByRole('link', { name: new RegExp(name, 'i') })
  }

  async clickSidebarGallery(name: string) {
    await this.ensureSidebarOpen()
    await this.sidebarGallery(name).click()
  }

  moderateButton(galleryName: string) {
    return this.galleryListItem(galleryName)
      .getByRole('link', { name: 'Moderieren' })
  }

  settingsButton(galleryName: string) {
    return this.galleryListItem(galleryName)
      .getByRole('link', { name: 'Einstellungen' })
  }
}
