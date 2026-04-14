import { type Page, type Locator } from '@playwright/test'

export class LightboxPage {
  readonly overlay: Locator
  readonly closeButton: Locator
  readonly nextButton: Locator
  readonly prevButton: Locator
  readonly photo: Locator
  readonly video: Locator

  constructor(private page: Page) {
    this.overlay = page.locator('.fixed.inset-0.z-50')
    this.closeButton = page.getByRole('button', { name: /schließen/i })
    this.nextButton = page.getByRole('button', { name: /nächstes/i })
    this.prevButton = page.getByRole('button', { name: /vorheriges/i })
    this.photo = page.locator('.fixed.inset-0.z-50 img, .fixed.inset-0.z-50 video').first()
    this.video = page.locator('.fixed.inset-0.z-50 video').first()
  }
}
