import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import { createBackendTestEnv, type BackendTestEnv } from './helpers/backendTestEnv.js'

let app: FastifyInstance
let testEnv: BackendTestEnv
const SETUP_TOKEN = 'test-setup-token-1234567890'

beforeAll(async () => {
  testEnv = await createBackendTestEnv('setup', {
    extraEnv: {
      SETUP_TOKEN,
    },
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
  await testEnv.cleanup()
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
  function withSetupTokenHeader() {
    return { 'x-setup-token': SETUP_TOKEN }
  }

  it('creates an admin user and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: withSetupTokenHeader(),
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
      headers: withSetupTokenHeader(),
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
      headers: withSetupTokenHeader(),
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
      headers: withSetupTokenHeader(),
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
      headers: withSetupTokenHeader(),
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
      headers: withSetupTokenHeader(),
      payload: {
        username: '',
        password: 'Password123!',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 401 when setup token is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        username: 'setup-admin',
        password: 'Password123!',
      },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().type).toBe('invalid-setup-token')
  })

  it('returns 401 when setup token is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { 'x-setup-token': 'wrong-token' },
      payload: {
        username: 'setup-admin',
        password: 'Password123!',
      },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().type).toBe('invalid-setup-token')
  })

  it('allows only one concurrent successful setup request', async () => {
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/setup',
        headers: withSetupTokenHeader(),
        payload: {
          username: 'setup-admin-a',
          password: 'Password123!',
        },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/setup',
        headers: withSetupTokenHeader(),
        payload: {
          username: 'setup-admin-b',
          password: 'Password123!',
        },
      }),
    ])

    const statusCodes = [first.statusCode, second.statusCode].sort()
    expect(statusCodes).toEqual([201, 409])

    const db = getClient()
    expect(await db.adminUser.count()).toBe(1)
  })
})
