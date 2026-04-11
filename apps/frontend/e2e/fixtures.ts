import { test as base, expect, type Page } from '@playwright/test'
import { ADMIN_STATE_FILE } from './global-setup'

type Fixtures = {
  adminPage: Page
}

export const test = base.extend<Fixtures>({
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: ADMIN_STATE_FILE })
    const page = await context.newPage()
    await use(page)
    await context.close()
  },
})

export { expect }
