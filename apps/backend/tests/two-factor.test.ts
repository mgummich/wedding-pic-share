import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { createHmac } from 'crypto'
import bcrypt from 'bcryptjs'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { seedAdmin } from '../src/seed.js'
import { closeClient, getClient } from '@wedding/db'

let app: FastifyInstance
const DB_PATH = `/tmp/wps-2fa-test-${process.pid}.db`

const FIXED_TIME = Date.parse('2026-04-14T12:00:00.000Z')

function decodeBase32(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '')

  let bits = ''
  for (const char of normalized) {
    const index = alphabet.indexOf(char)
    if (index === -1) throw new Error('Invalid base32 character')
    bits += index.toString(2).padStart(5, '0')
  }

  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

function generateTotp(secret: string, timestampMs: number): string {
  const key = decodeBase32(secret)
  const counter = Math.floor(timestampMs / 1000 / 30)
  const msg = Buffer.alloc(8)
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  msg.writeUInt32BE(counter >>> 0, 4)

  const digest = createHmac('sha1', key).update(msg).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  ) % 1_000_000

  return String(code).padStart(6, '0')
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${DB_PATH}`
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'testadmin'
  process.env.ADMIN_PASSWORD = 'TestPassword123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-test-2fa'
  process.env.NODE_ENV = 'test'
  process.env.TOTP_ENABLED = 'true'
  process.env.TOTP_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

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
  vi.spyOn(Date, 'now').mockImplementation(() => FIXED_TIME)

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

describe('admin two-factor authentication', () => {
  it('supports setup, verification, and totp-protected login', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    expect(login.statusCode).toBe(200)
    const cookie = login.headers['set-cookie'] as string

    const statusBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/2fa/status',
      headers: { cookie },
    })
    expect(statusBefore.statusCode).toBe(200)
    expect(statusBefore.json()).toEqual({
      enabled: true,
      configured: false,
    })

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/2fa/setup',
      headers: { cookie },
      payload: { password: 'TestPassword123!' },
    })
    expect(setup.statusCode).toBe(200)
    const setupBody = setup.json() as { secret: string; otpauthUrl: string; setupToken: string }
    expect(setupBody.secret).toMatch(/^[A-Z2-7]+=*$/)
    expect(setupBody.otpauthUrl).toContain('otpauth://totp/')
    expect(setupBody.setupToken.length).toBeGreaterThan(20)

    const validCode = generateTotp(setupBody.secret, FIXED_TIME)
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/2fa/verify',
      headers: { cookie },
      payload: {
        code: validCode,
        setupToken: setupBody.setupToken,
      },
    })
    expect(verify.statusCode).toBe(200)
    expect(verify.json()).toEqual({ ok: true })

    const statusAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/2fa/status',
      headers: { cookie },
    })
    expect(statusAfter.statusCode).toBe(200)
    expect(statusAfter.json()).toEqual({
      enabled: true,
      configured: true,
    })

    const loginWithoutCode = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    expect(loginWithoutCode.statusCode).toBe(401)
    expect(loginWithoutCode.json().type).toBe('totp-required')

    const loginWithWrongCode = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!', totpCode: '000000' },
    })
    expect(loginWithWrongCode.statusCode).toBe(401)
    expect(loginWithWrongCode.json().type).toBe('invalid-totp')

    const loginWithCode = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!', totpCode: validCode },
    })
    expect(loginWithCode.statusCode).toBe(200)
    expect(String(loginWithCode.headers['set-cookie'])).toContain('session=')
  })

  it('rejects reused setup tokens after first successful verification', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    const cookie = login.headers['set-cookie'] as string

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/2fa/setup',
      headers: { cookie },
      payload: { password: 'TestPassword123!' },
    })
    const setupBody = setup.json() as { secret: string; setupToken: string }
    const validCode = generateTotp(setupBody.secret, FIXED_TIME)

    const firstVerify = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/2fa/verify',
      headers: { cookie },
      payload: { code: validCode, setupToken: setupBody.setupToken },
    })
    expect(firstVerify.statusCode).toBe(200)

    const secondVerify = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/2fa/verify',
      headers: { cookie },
      payload: { code: validCode, setupToken: setupBody.setupToken },
    })
    expect(secondVerify.statusCode).toBe(400)
    expect(secondVerify.json().type).toBe('setup-token-used')
  })

  it('binds setup token to the authenticated admin user', async () => {
    const db = getClient()
    const passwordHash = await bcrypt.hash('OtherPassword123!', 12)
    await db.adminUser.create({
      data: { username: 'otheradmin', passwordHash },
    })

    const loginPrimary = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    const primaryCookie = loginPrimary.headers['set-cookie'] as string

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/2fa/setup',
      headers: { cookie: primaryCookie },
      payload: { password: 'TestPassword123!' },
    })
    const setupBody = setup.json() as { secret: string; setupToken: string }
    const validCode = generateTotp(setupBody.secret, FIXED_TIME)

    const loginSecondary = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'otheradmin', password: 'OtherPassword123!' },
    })
    const secondaryCookie = loginSecondary.headers['set-cookie'] as string

    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/2fa/verify',
      headers: { cookie: secondaryCookie },
      payload: { code: validCode, setupToken: setupBody.setupToken },
    })
    expect(verify.statusCode).toBe(400)
    expect(verify.json().type).toBe('invalid-setup-token')
  })

  it('rate-limits repeated invalid verify attempts', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    const cookie = login.headers['set-cookie'] as string

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/2fa/setup',
      headers: { cookie },
      payload: { password: 'TestPassword123!' },
    })
    const setupBody = setup.json() as { setupToken: string }

    for (let i = 0; i < 5; i += 1) {
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/2fa/verify',
        headers: { cookie },
        payload: { code: '000000', setupToken: setupBody.setupToken },
      })
      expect(invalid.statusCode).toBe(401)
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/2fa/verify',
      headers: { cookie },
      payload: { code: '000000', setupToken: setupBody.setupToken },
    })
    expect(limited.statusCode).toBe(429)
    expect(limited.json().type).toBe('totp-verify-rate-limited')
  })
})
