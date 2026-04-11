import { type Page, type Locator } from '@playwright/test'

export class UploadPage {
  readonly fileInput: Locator
  readonly guestNameInput: Locator
  readonly submitButton: Locator
  readonly successHeading: Locator

  constructor(private page: Page) {
    this.fileInput = page.getByLabel('Fotos auswählen')
    this.guestNameInput = page.getByLabel(/dein name/i)
    this.submitButton = page.getByRole('button', { name: /hochladen/i })
    this.successHeading = page.getByRole('heading', { name: 'Danke!' })
  }

  async goto(slug: string) {
    await this.page.goto(`/g/${slug}/upload`)
  }

  formError(text: RegExp | string) {
    return this.page.getByText(text)
  }
}
