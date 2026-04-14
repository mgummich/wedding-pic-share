import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import { createBackendTestEnv, type BackendTestEnv } from './helpers/backendTestEnv.js'
import { hashSessionToken } from '../src/services/sessionToken.js'

let app: FastifyInstance
let testEnv: BackendTestEnv

beforeAll(async () => {
  testEnv = await createBackendTestEnv('auth', {
    adminUsername: 'testadmin',
    adminPassword: 'TestPassword123!',
  })

  const config = loadConfig()
  app = await buildApp(config)
  await app.ready()

  const { seedAdmin } = await import('../src/seed.js')
  await seedAdmin(config)
})

afterAll(async () => {
  await app?.close()
  await closeClient()
  await testEnv.cleanup()
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

  it('stores only a hashed session token in the database', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })

    const cookieHeader = String(res.headers['set-cookie'])
    const sessionCookie = cookieHeader.split(';')[0] ?? ''
    const token = sessionCookie.replace(/^session=/, '')
    expect(token.length).toBeGreaterThan(0)

    const db = getClient()
    const stored = await db.session.findUnique({
      where: { token: hashSessionToken(token) },
    })

    expect(stored).not.toBeNull()
    const plaintext = await db.session.findUnique({
      where: { token },
    })
    expect(plaintext).toBeNull()
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

  it('rejects and removes expired session rows', async () => {
    const db = getClient()
    await db.session.deleteMany()
    const admin = await db.adminUser.findUniqueOrThrow({ where: { username: 'testadmin' } })

    const token = 'expired-session-token'
    await db.session.create({
      data: {
        adminUserId: admin.id,
        token: hashSessionToken(token),
        expiresAt: new Date(Date.now() - 60_000),
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/session',
      headers: { cookie: `session=${token}` },
    })
    expect(res.statusCode).toBe(401)

    const stillExists = await db.session.findUnique({ where: { token } })
    const stillHashed = await db.session.findUnique({ where: { token: hashSessionToken(token) } })
    expect(stillExists).toBeNull()
    expect(stillHashed).toBeNull()
  })

  it('accepts legacy plaintext session rows and migrates them to hashed tokens', async () => {
    const db = getClient()
    await db.session.deleteMany()
    const admin = await db.adminUser.findUniqueOrThrow({ where: { username: 'testadmin' } })
    const token = 'legacy-session-token'

    await db.session.create({
      data: {
        adminUserId: admin.id,
        token,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/session',
      headers: { cookie: `session=${token}` },
    })
    expect(res.statusCode).toBe(200)

    const migrated = await db.session.findUnique({ where: { token: hashSessionToken(token) } })
    expect(migrated).not.toBeNull()
    const legacy = await db.session.findUnique({ where: { token } })
    expect(legacy).toBeNull()
  })
})

describe('POST /api/v1/admin/sessions/revoke-all', () => {
  it('revokes all sessions for the current admin user', async () => {
    const db = getClient()
    await db.session.deleteMany()

    const loginA = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    const cookieA = String(loginA.headers['set-cookie']).split(';')[0]

    const loginB = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    const cookieB = String(loginB.headers['set-cookie']).split(';')[0]

    const revoke = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/sessions/revoke-all',
      headers: { cookie: cookieA },
    })
    expect(revoke.statusCode).toBe(200)
    expect(revoke.json().ok).toBe(true)

    const remaining = await db.session.count()
    expect(remaining).toBe(0)

    const checkOldSession = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/session',
      headers: { cookie: cookieB },
    })
    expect(checkOldSession.statusCode).toBe(401)
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
