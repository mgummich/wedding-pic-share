import { type Page, type Locator } from '@playwright/test'

export class GallerySettingsPage {
  readonly nameInput: Locator
  readonly descriptionInput: Locator
  readonly saveButton: Locator
  readonly savedMessage: Locator
  readonly deleteButton: Locator
  readonly confirmDeleteButton: Locator
  readonly cancelDeleteButton: Locator

  constructor(private page: Page) {
    this.nameInput = page.getByLabel('Name')
    this.descriptionInput = page.getByLabel(/Beschreibung/)
    this.saveButton = page.getByRole('button', { name: 'Speichern' })
    this.savedMessage = page.getByText('Gespeichert ✓')
    this.deleteButton = page.getByRole('button', { name: 'Galerie löschen' })
    this.confirmDeleteButton = page.getByRole('button', { name: 'Wirklich löschen' })
    this.cancelDeleteButton = page.getByRole('button', { name: 'Abbrechen' })
  }

  async goto(id: string) {
    await this.page.goto(`/admin/galleries/${id}`)
  }
}
