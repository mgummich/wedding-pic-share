import { type Page, type Locator } from '@playwright/test'

export class NewGalleryPage {
  readonly weddingNameInput: Locator
  readonly weddingSlugInput: Locator
  readonly galleryNameInput: Locator
  readonly gallerySlugInput: Locator
  readonly submitButton: Locator
  readonly errorMessage: Locator

  constructor(private page: Page) {
    this.weddingNameInput = page.getByLabel('Name der Hochzeit')
    // Two fields share the label text "Slug" — use stable HTML ids
    this.weddingSlugInput = page.locator('#wedding-slug')
    this.galleryNameInput = page.getByLabel('Name der Galerie')
    this.gallerySlugInput = page.locator('#gallery-slug')
    this.submitButton = page.getByRole('button', { name: 'Galerie erstellen' })
    this.errorMessage = page.getByText(/existiert bereits|ist aufgetreten/i)
  }

  async goto() {
    await this.page.goto('/admin/galleries/new')
  }
}
