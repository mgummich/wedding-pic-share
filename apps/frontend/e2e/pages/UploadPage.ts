import { type Page, type Locator } from '@playwright/test'

export class UploadPage {
  readonly fileInput: Locator
  readonly guestNameInput: Locator
  readonly submitButton: Locator
  readonly successHeading: Locator

  constructor(private page: Page) {
    this.fileInput = page.locator('#file-input')
    this.guestNameInput = page.getByLabel(/dein name/i)
    this.submitButton = page.getByRole('button', { name: /hochladen/i })
    this.successHeading = page.getByRole('heading', { name: 'Danke!' })
  }

  async goto(slug: string) {
    await this.page.goto(`/g/${slug}/upload`)
    await this.page.waitForLoadState('networkidle')
    await this.page.getByRole('heading', { name: /fotos hochladen|upload photos/i }).waitFor()
  }

  async selectFiles(
    files:
      | string
      | { name: string; mimeType: string; buffer: Buffer }
      | Array<string | { name: string; mimeType: string; buffer: Buffer }>
  ) {
    await this.fileInput.setInputFiles(files)
  }

  formError(text: RegExp | string) {
    return this.page.getByText(text)
  }
}
