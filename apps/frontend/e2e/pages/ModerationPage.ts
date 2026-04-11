import { type Page, type Locator } from '@playwright/test'

export class ModerationPage {
  readonly approveAllButton: Locator
  readonly emptyState: Locator
  readonly pendingCount: Locator

  constructor(private page: Page) {
    this.approveAllButton = page.getByRole('button', { name: 'Alle freigeben' })
    this.emptyState = page.getByText('Alles erledigt!')
    this.pendingCount = page.getByText(/\d+ ausstehend/)
  }

  firstApproveButton() {
    // Use exact aria-label match to avoid matching "Alle freigeben"
    return this.page.getByRole('button', { name: /^Freigeben$/ }).first()
  }

  firstRejectButton() {
    return this.page.getByRole('button', { name: /^Ablehnen$/ }).first()
  }
}
