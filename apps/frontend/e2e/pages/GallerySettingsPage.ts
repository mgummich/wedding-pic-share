import { type Page, type Locator } from '@playwright/test'

export class GallerySettingsPage {
  readonly nameInput: Locator
  readonly descriptionInput: Locator
  readonly saveButton: Locator
  readonly savedMessage: Locator
  readonly deleteButton: Locator
  readonly confirmDeleteButton: Locator
  readonly cancelDeleteButton: Locator
  readonly qrDownloadPng: Locator
  readonly qrDownloadSvg: Locator
  readonly exportButton: Locator
  readonly adminUploadInput: Locator
  readonly adminUploadStartButton: Locator
  readonly adminUploadQueue: Locator

  constructor(private page: Page) {
    this.nameInput = page.getByLabel('Name', { exact: true })
    this.descriptionInput = page.getByLabel(/Beschreibung/)
    this.saveButton = page.getByRole('button', { name: 'Speichern' })
    this.savedMessage = page.getByText('Gespeichert ✓')
    this.deleteButton = page.getByRole('button', { name: 'Galerie löschen' })
    this.confirmDeleteButton = page.getByRole('button', { name: 'Wirklich löschen' })
    this.cancelDeleteButton = page.getByRole('button', { name: 'Abbrechen' })
    this.qrDownloadPng = page.getByRole('link', { name: /qr-code als png herunterladen/i })
    this.qrDownloadSvg = page.getByRole('link', { name: /qr-code als svg herunterladen/i })
    this.exportButton = page.getByRole('button', { name: /zip exportieren/i })
    this.adminUploadInput = page.getByLabel('Dateien auswählen')
    this.adminUploadStartButton = page.getByRole('button', { name: /uploads starten/i })
    this.adminUploadQueue = page.getByRole('list', { name: /upload-warteschlange/i })
  }

  async goto(id: string) {
    await this.page.goto(`/admin/galleries/${id}`)
  }
}
