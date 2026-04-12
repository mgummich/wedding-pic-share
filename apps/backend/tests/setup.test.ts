import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'

const DB_PATH = `/tmp/wps-setup-test-${process.pid}.db`

let app: FastifyInstance

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${DB_PATH}`
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = 'Password123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-test-setup'
  process.env.NODE_ENV = 'test'

  const { execSync } = await import('child_process')
  execSync('npx prisma migrate deploy', {
    cwd: join(process.cwd(), '../../packages/db'),
    env: { ...process.env },
    stdio: 'pipe',
  })

  app = await buildApp(loadConfig())
  await app.ready()
})

beforeEach(async () => {
  const db = getClient()
  await db.session.deleteMany()
  await db.photo.deleteMany()
  await db.gallery.deleteMany()
  await db.wedding.deleteMany()
  await db.adminUser.deleteMany()
})

afterAll(async () => {
  if (app) {
    await app.close()
  }
  await closeClient()
  await unlink(DB_PATH).catch(() => {})
  await unlink(`${DB_PATH}-wal`).catch(() => {})
  await unlink(`${DB_PATH}-shm`).catch(() => {})
})

describe('GET /api/v1/setup/status', () => {
  it('returns setupRequired true when no admin exists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/setup/status',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ setupRequired: true })
  })

  it('returns setupRequired false when an admin exists', async () => {
    const db = getClient()
    await db.adminUser.create({
      data: {
        username: 'existing-admin',
        passwordHash: 'hashed-password',
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/setup/status',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ setupRequired: false })
  })
})

describe('POST /api/v1/setup', () => {
  it('creates an admin user and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        username: 'setup-admin',
        password: 'Password123!',
      },
    })

    expect(res.statusCode).toBe(201)

    const db = getClient()
    const admin = await db.adminUser.findUnique({ where: { username: 'setup-admin' } })
    expect(admin).toBeTruthy()
  })

  it('creates a wedding and gallery when weddingName is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        username: 'setup-admin',
        password: 'Password123!',
        weddingName: 'Lea & Tom',
        galleryName: 'Party',
      },
    })

    expect(res.statusCode).toBe(201)

    const db = getClient()
    const wedding = await db.wedding.findFirst({
      where: { slug: 'lea-tom' },
      include: { galleries: true },
    })
    expect(wedding).toBeTruthy()
    expect(wedding?.galleries).toHaveLength(1)
    expect(wedding?.galleries[0]?.slug).toBe('party')
  })

  it('does not create a wedding when weddingName is omitted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        username: 'setup-admin',
        password: 'Password123!',
      },
    })

    expect(res.statusCode).toBe(201)

    const db = getClient()
    expect(await db.wedding.count()).toBe(0)
  })

  it('returns 409 when setup is already complete', async () => {
    const db = getClient()
    await db.adminUser.create({
      data: {
        username: 'existing-admin',
        passwordHash: 'hashed-password',
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        username: 'setup-admin',
        password: 'Password123!',
      },
    })

    expect(res.statusCode).toBe(409)
  })

  it('returns 400 for a short password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        username: 'setup-admin',
        password: 'short',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for an empty username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        username: '',
        password: 'Password123!',
      },
    })

    expect(res.statusCode).toBe(400)
  })
})
