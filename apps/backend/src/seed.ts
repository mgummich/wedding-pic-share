import bcrypt from 'bcryptjs'
import { getClient } from '@wedding/db'
import type { AppConfig } from './config.js'

export async function seedAdmin(config: AppConfig): Promise<void> {
  const db = getClient()
  const existing = await db.adminUser.findUnique({
    where: { username: config.adminUsername },
  })
  if (existing) return

  const passwordHash = await bcrypt.hash(config.adminPassword, 12)
  await db.adminUser.create({
    data: { username: config.adminUsername, passwordHash },
  })
}
