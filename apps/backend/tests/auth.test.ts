import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import { unlink } from 'fs/promises'
import { join } from 'path'

let app: FastifyInstance

beforeAll(async () => {
  process.env.DATABASE_URL = 'file:/tmp/wps-auth-test.db'
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'testadmin'
  process.env.ADMIN_PASSWORD = 'TestPassword123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-test-auth'
  process.env.NODE_ENV = 'test'

  // Apply migrations to temp file DB
  const { execSync } = await import('child_process')
  execSync('npx prisma migrate deploy', {
    cwd: join(process.cwd(), '../../packages/db'),
    env: { ...process.env },
    stdio: 'pipe',
  })

  const config = loadConfig()
  app = await buildApp(config)
  await app.ready()

  const { seedAdmin } = await import('../src/seed.js')
  await seedAdmin(config)
})

afterAll(async () => {
  await app.close()
  await closeClient()
  await unlink('/tmp/wps-auth-test.db').catch(() => {})
})

describe('POST /api/v1/admin/login', () => {
  it('returns 200 and sets session cookie on valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    expect(res.statusCode).toBe(200)
    const cookies = res.headers['set-cookie']
    expect(cookies).toBeTruthy()
    expect(String(cookies)).toContain('session=')
  })

  it('returns 401 on wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'WrongPassword' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 on unknown user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'nobody', password: 'anything' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/v1/admin/logout', () => {
  it('clears the session cookie', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    const cookie = login.headers['set-cookie'] as string

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/logout',
      headers: { cookie },
    })
    expect(logout.statusCode).toBe(200)
    expect(logout.json().ok).toBe(true)
  })
})

describe('GET /api/v1/admin/session', () => {
  it('returns 200 with a valid session cookie', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    const cookie = login.headers['set-cookie'] as string

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/session',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })
})

describe('2FA downgrade protection', () => {
  it('fails closed when a user has a configured TOTP secret but server-side TOTP is disabled', async () => {
    const db = getClient()
    await db.adminUser.update({
      where: { username: 'testadmin' },
      data: {
        totpSecretEncrypted: 'deadbeef',
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })

    expect(res.statusCode).toBe(503)
    expect(res.json().type).toBe('totp-misconfigured')
  })
})
