import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import { join } from 'path'
import { unlink } from 'fs/promises'

const DB_PATH = '/tmp/wps-gallery-test.db'

let app: FastifyInstance
let sessionCookie: string
let galleryId: string

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${DB_PATH}`
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = 'Password123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-gallery-storage'
  process.env.NODE_ENV = 'test'

  const { execSync } = await import('child_process')
  execSync('npx prisma migrate deploy', {
    cwd: join(process.cwd(), '../../packages/db'),
    env: { ...process.env },
    stdio: 'ignore',
  })

  const config = loadConfig()
  app = await buildApp(config)
  await app.ready()

  const { seedAdmin } = await import('../src/seed.js')
  await seedAdmin(config)

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/login',
    payload: { username: 'admin', password: 'Password123!' },
  })
  sessionCookie = login.headers['set-cookie'] as string
})

afterAll(async () => {
  await app.close()
  await closeClient()
  await unlink(DB_PATH).catch(() => {})
  await unlink(`${DB_PATH}-shm`).catch(() => {})
  await unlink(`${DB_PATH}-wal`).catch(() => {})
})

describe('POST /api/v1/admin/galleries', () => {
  it('creates a wedding + gallery', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/galleries',
      headers: { cookie: sessionCookie },
      payload: {
        weddingName: 'Emma & Max',
        weddingSlug: 'emma-max-2026',
        galleryName: 'Party',
        gallerySlug: 'party',
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    galleryId = body.id
    expect(body.slug).toBe('party')
    expect(body.layout).toBe('MASONRY')
  })

  it('returns 409 on duplicate slug within same wedding', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/galleries',
      headers: { cookie: sessionCookie },
      payload: {
        weddingName: 'Emma & Max',
        weddingSlug: 'emma-max-2026',
        galleryName: 'Party Again',
        gallerySlug: 'party',
      },
    })
    expect(res.statusCode).toBe(409)
  })

  it('rejects invalid slug characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/galleries',
      headers: { cookie: sessionCookie },
      payload: {
        weddingName: 'Test',
        weddingSlug: 'test',
        galleryName: 'Bad',
        gallerySlug: 'Bad Slug!!!',
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/v1/g/:slug', () => {
  it('returns gallery with photoCount and pagination', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/g/party' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.name).toBe('Party')
    expect(typeof body.photoCount).toBe('number')
    expect(body.pagination).toBeDefined()
    expect(body.data).toBeInstanceOf(Array)
  })

  it('includes upload window metadata and open state on guest gallery responses', async () => {
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: {
        uploadWindows: [
          {
            start: '2035-06-01T12:00:00.000Z',
            end: '2035-06-01T16:00:00.000Z',
          },
        ],
      },
    })
    expect(update.statusCode).toBe(200)

    const res = await app.inject({ method: 'GET', url: '/api/v1/g/party' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.uploadWindows).toHaveLength(1)
    expect(body.isUploadOpen).toBe(false)
  })

  it('returns 404 for unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/g/does-not-exist' })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /api/v1/admin/galleries/:id', () => {
  it('updates gallery settings', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: { allowGuestDownload: true, layout: 'GRID' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().allowGuestDownload).toBe(true)
    expect(res.json().layout).toBe('GRID')
  })

  it('deactivates previously active galleries when another gallery is activated', async () => {
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/galleries',
      headers: { cookie: sessionCookie },
      payload: {
        weddingName: 'Emma & Max',
        weddingSlug: 'emma-max-2026',
        galleryName: 'Afterparty',
        gallerySlug: 'afterparty',
      },
    })
    expect(second.statusCode).toBe(201)
    const secondId = second.json().id as string

    const firstActivate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: { isActive: true },
    })
    expect(firstActivate.statusCode).toBe(200)

    const secondActivate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${secondId}`,
      headers: { cookie: sessionCookie },
      payload: { isActive: true },
    })
    expect(secondActivate.statusCode).toBe(200)

    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/galleries',
      headers: { cookie: sessionCookie },
    })
    expect(all.statusCode).toBe(200)

    const weddings = all.json() as Array<{ galleries: Array<{ id: string; isActive: boolean }> }>
    const galleries = weddings.flatMap((w) => w.galleries)
    expect(galleries.find((g) => g.id === galleryId)?.isActive).toBe(false)
    expect(galleries.find((g) => g.id === secondId)?.isActive).toBe(true)
  })
})

describe('GET /api/v1/admin/galleries', () => {
  it('returns list of weddings with galleries', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/galleries',
      headers: { cookie: sessionCookie },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
  })
})

describe('GET /api/v1/g/active', () => {
  it('returns the active gallery', async () => {
    const activate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: { isActive: true },
    })
    expect(activate.statusCode).toBe(200)

    const res = await app.inject({ method: 'GET', url: '/api/v1/g/active' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.slug).toBe('party')
    expect(body.isActive).toBe(true)
  })
})
