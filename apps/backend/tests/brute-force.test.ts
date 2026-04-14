import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { seedAdmin } from '../src/seed.js'
import { closeClient, getClient } from '@wedding/db'

let app: FastifyInstance
const DB_PATH = `/tmp/wps-bruteforce-test-${process.pid}.db`
let nowMs = Date.parse('2026-04-12T09:00:00.000Z')

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${DB_PATH}`
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'testadmin'
  process.env.ADMIN_PASSWORD = 'TestPassword123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-test-bruteforce'
  process.env.NODE_ENV = 'test'

  const { execSync } = await import('child_process')
  execSync('npx prisma migrate deploy', {
    cwd: join(process.cwd(), '../../packages/db'),
    env: { ...process.env },
    stdio: 'pipe',
  })

  const config = loadConfig()
  app = await buildApp(config)
  await app.ready()
})

beforeEach(async () => {
  nowMs = Date.parse('2026-04-12T09:00:00.000Z')
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs)

  const db = getClient()
  await db.session.deleteMany()
  await db.adminUser.deleteMany()
  await seedAdmin(loadConfig())
})

afterEach(async () => {
  vi.restoreAllMocks()
  await closeClient()
})

afterAll(async () => {
  if (app) {
    await app.close()
  }
  await unlink(DB_PATH).catch(() => {})
  await unlink(`${DB_PATH}-wal`).catch(() => {})
  await unlink(`${DB_PATH}-shm`).catch(() => {})
})

async function login(password: string, ip = '127.0.0.1') {
  return app.inject({
    method: 'POST',
    url: '/api/v1/admin/login',
    remoteAddress: ip,
    payload: { username: 'testadmin', password },
  })
}

describe('admin login brute-force protection', () => {
  it('locks the account after 5 failed attempts and returns 429 on the next attempt', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await login('WrongPassword123!')
      expect(res.statusCode).toBe(401)
    }

    const locked = await login('WrongPassword123!')
    expect(locked.statusCode).toBe(429)
    expect(locked.json().type).toBe('account-locked')
  })

  it('resets failedAttempts to 0 after a successful login', async () => {
    await login('WrongPassword123!')
    await login('WrongPassword123!')

    const success = await login('TestPassword123!')
    expect(success.statusCode).toBe(200)

    const db = getClient()
    const user = await db.adminUser.findUniqueOrThrow({ where: { username: 'testadmin' } })
    expect(user.failedAttempts).toBe(0)
    expect(user.lockedUntil).toBeNull()
  })

  it('allows login again after the account lock expires', async () => {
    for (let i = 0; i < 5; i += 1) {
      await login('WrongPassword123!')
    }

    nowMs = Date.parse('2026-04-12T09:16:00.000Z')

    const success = await login('TestPassword123!')
    expect(success.statusCode).toBe(200)
  })

  it('blocks an IP after 15 failures and returns 429 ip-blocked', async () => {
    const db = getClient()

    for (let i = 0; i < 15; i += 1) {
      await db.adminUser.update({
        where: { username: 'testadmin' },
        data: { failedAttempts: 0, lockedUntil: null },
      })
      await login('WrongPassword123!', '10.0.0.5')
    }

    const blocked = await login('WrongPassword123!', '10.0.0.5')
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().type).toBe('ip-blocked')
  })

  it('applies ip counters consistently under concurrent failed attempts', async () => {
    const ip = '10.0.0.66'
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () => app.inject({
        method: 'POST',
        url: '/api/v1/admin/login',
        remoteAddress: ip,
        payload: {
          username: 'unknown-user',
          password: 'WrongPassword123!',
        },
      }))
    )
    expect(attempts.every((res) => res.statusCode === 401 || res.statusCode === 429)).toBe(true)

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      remoteAddress: ip,
      payload: {
        username: 'unknown-user',
        password: 'WrongPassword123!',
      },
    })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().type).toBe('ip-blocked')
  })
})
