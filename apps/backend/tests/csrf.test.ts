import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import { createBackendTestEnv, type BackendTestEnv } from './helpers/backendTestEnv.js'

let app: FastifyInstance
let testEnv: BackendTestEnv

beforeAll(async () => {
  testEnv = await createBackendTestEnv('csrf', {
    adminUsername: 'csrfadmin',
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

describe('admin csrf protection', () => {
  it('requires session for csrf token endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/csrf',
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects admin mutating requests with origin header when csrf token is missing', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'csrfadmin', password: 'TestPassword123!' },
    })
    const sessionCookie = String(login.headers['set-cookie']).split(';')[0]

    const createWithoutToken = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/galleries',
      headers: {
        cookie: sessionCookie,
        origin: 'http://localhost:3000',
      },
      payload: {
        weddingName: 'CSRF Wedding',
        weddingSlug: 'csrf-wedding',
        galleryName: 'CSRF Gallery',
        gallerySlug: 'csrf-gallery',
      },
    })
    expect(createWithoutToken.statusCode).toBe(403)

    const csrf = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/csrf',
      headers: { cookie: sessionCookie },
    })
    expect(csrf.statusCode).toBe(200)
    const csrfToken = csrf.json().csrfToken as string
    expect(typeof csrfToken).toBe('string')
    expect(csrfToken.length).toBeGreaterThan(10)

    const csrfCookie = String(csrf.headers['set-cookie']).split(';')[0]

    const createWithToken = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/galleries',
      headers: {
        cookie: `${sessionCookie}; ${csrfCookie}`,
        origin: 'http://localhost:3000',
        'x-csrf-token': csrfToken,
      },
      payload: {
        weddingName: 'CSRF Wedding',
        weddingSlug: 'csrf-wedding',
        galleryName: 'CSRF Gallery',
        gallerySlug: 'csrf-gallery',
      },
    })
    expect(createWithToken.statusCode).toBe(201)
  })
})
