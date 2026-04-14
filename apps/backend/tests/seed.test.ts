import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import { closeClient, getClient } from '@wedding/db'
import { loadConfig } from '../src/config.js'
import { seedAdmin } from '../src/seed.js'
import { createBackendTestEnv, type BackendTestEnv } from './helpers/backendTestEnv.js'

let testEnv: BackendTestEnv
let originalAdminPassword: string | undefined

beforeAll(async () => {
  testEnv = await createBackendTestEnv('seed', {
    adminUsername: 'seedadmin',
    adminPassword: 'SeedPassword123!',
  })
  originalAdminPassword = process.env.ADMIN_PASSWORD
})

afterAll(async () => {
  if (originalAdminPassword === undefined) {
    delete process.env.ADMIN_PASSWORD
  } else {
    process.env.ADMIN_PASSWORD = originalAdminPassword
  }
  await closeClient()
  await testEnv.cleanup()
})

describe('seedAdmin', () => {
  it('updates the existing admin password hash when ADMIN_PASSWORD changes', async () => {
    const firstConfig = loadConfig()
    await seedAdmin(firstConfig)

    const db = getClient()
    const userAfterFirstSeed = await db.adminUser.findUniqueOrThrow({
      where: { username: firstConfig.adminUsername },
    })
    expect(await bcrypt.compare('SeedPassword123!', userAfterFirstSeed.passwordHash)).toBe(true)

    process.env.ADMIN_PASSWORD = 'SeedPassword456!'
    const secondConfig = loadConfig()
    await seedAdmin(secondConfig)

    const userAfterSecondSeed = await db.adminUser.findUniqueOrThrow({
      where: { username: secondConfig.adminUsername },
    })
    expect(await bcrypt.compare('SeedPassword456!', userAfterSecondSeed.passwordHash)).toBe(true)
    expect(await bcrypt.compare('SeedPassword123!', userAfterSecondSeed.passwordHash)).toBe(false)
  })

  it('does not change the stored hash when credentials stay unchanged', async () => {
    const config = loadConfig()
    const db = getClient()
    const first = await db.adminUser.findUniqueOrThrow({ where: { username: config.adminUsername } })
    const updateSpy = vi.spyOn(db.adminUser, 'update')
    await seedAdmin(config)

    const second = await db.adminUser.findUniqueOrThrow({ where: { username: config.adminUsername } })
    expect(second.passwordHash).toBe(first.passwordHash)
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
