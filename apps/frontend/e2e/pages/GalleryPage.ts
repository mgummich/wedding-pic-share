import { type Page, type Locator } from '@playwright/test'

export class GalleryPage {
  readonly uploadButton: Locator
  readonly loadMoreButton: Locator

  constructor(private page: Page) {
    this.uploadButton = page.getByRole('link', { name: /moment festhalten/i })
    this.loadMoreButton = page.getByRole('button', { name: /mehr laden/i })
  }

  async goto(slug: string) {
    await this.page.goto(`/g/${slug}`)
  }

  async gotoSlideshow(slug: string) {
    await this.page.goto(`/g/${slug}/slideshow`)
  }
}
