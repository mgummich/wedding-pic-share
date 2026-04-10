import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { getClient, closeClient } from '../src/index.js'

describe('prisma client', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test-client.db'
    execSync('pnpm prisma migrate deploy', {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: 'file:./test-client.db' },
      stdio: 'pipe',
    })
    const db = getClient()
    await db.$connect()
  })

  afterAll(async () => {
    await closeClient()
    const { unlink } = await import('fs/promises')
    await unlink('./test-client.db').catch(() => {})
    await unlink('./test-client.db-shm').catch(() => {})
    await unlink('./test-client.db-wal').catch(() => {})
  })

  it('connects to the database', async () => {
    const db = getClient()
    const result = await db.$queryRaw<[{ result: number | bigint }]>`SELECT 1 as result`
    expect(Number(result[0].result)).toBe(1)
  })

  it('can create and retrieve a Wedding record', async () => {
    const db = getClient()
    const wedding = await db.wedding.create({
      data: { name: 'Test Wedding', slug: `test-wedding-${Date.now()}` },
    })
    expect(wedding.id).toBeTruthy()

    const found = await db.wedding.findUnique({ where: { id: wedding.id } })
    expect(found?.name).toBe('Test Wedding')
  })
})
