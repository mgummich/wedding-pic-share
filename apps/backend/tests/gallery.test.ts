import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import { join } from 'path'
import { unlink } from 'fs/promises'
import bcrypt from 'bcryptjs'

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
    expect(body.stripExif).toBe(true)
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
    expect(body.stripExif).toBe(true)
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

  it('paginates consistently with cursor even when ids do not match creation order', async () => {
    const db = getClient()
    await db.photo.createMany({
      data: [
        {
          id: 'photo_a_new',
          galleryId,
          fileHash: 'cursor-hash-new',
          mediaType: 'IMAGE',
          originalPath: 'photo_a_new_original.webp',
          thumbPath: 'photo_a_new_thumb.webp',
          displayPath: 'photo_a_new_display.webp',
          mimeType: 'image/webp',
          status: 'APPROVED',
          blurDataUrl: '',
          exifStripped: true,
          createdAt: new Date('2036-01-01T10:02:00.000Z'),
        },
        {
          id: 'photo_z_old',
          galleryId,
          fileHash: 'cursor-hash-old-z',
          mediaType: 'IMAGE',
          originalPath: 'photo_z_old_original.webp',
          thumbPath: 'photo_z_old_thumb.webp',
          displayPath: 'photo_z_old_display.webp',
          mimeType: 'image/webp',
          status: 'APPROVED',
          blurDataUrl: '',
          exifStripped: true,
          createdAt: new Date('2036-01-01T10:01:00.000Z'),
        },
        {
          id: 'photo_y_old',
          galleryId,
          fileHash: 'cursor-hash-old-y',
          mediaType: 'IMAGE',
          originalPath: 'photo_y_old_original.webp',
          thumbPath: 'photo_y_old_thumb.webp',
          displayPath: 'photo_y_old_display.webp',
          mimeType: 'image/webp',
          status: 'APPROVED',
          blurDataUrl: '',
          exifStripped: true,
          createdAt: new Date('2036-01-01T10:00:00.000Z'),
        },
      ],
    })

    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 5; i += 1) {
      const url = cursor ? `/api/v1/g/party?limit=1&cursor=${encodeURIComponent(cursor)}` : '/api/v1/g/party?limit=1'
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        data: Array<{ id: string }>
        pagination: { nextCursor: string | null; hasMore: boolean }
      }
      seen.push(...body.data.map((photo) => photo.id))
      cursor = body.pagination.nextCursor
      if (!body.pagination.hasMore) break
    }

    const unique = new Set(seen)
    expect(unique.has('photo_a_new')).toBe(true)
    expect(unique.has('photo_z_old')).toBe(true)
    expect(unique.has('photo_y_old')).toBe(true)
  })
})

describe('GET /api/v1/g/:slug/qr', () => {
  it('returns a printable table card PDF for format=pdf', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/g/party/qr?format=pdf',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(String(res.headers['content-disposition'])).toContain('party-table-card.pdf')
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('returns 404 for qr export with unknown slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/g/does-not-exist/qr?format=pdf',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().type).toBe('gallery-not-found')
  })
})

describe('PATCH /api/v1/admin/galleries/:id', () => {
  it('updates gallery settings', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: { allowGuestDownload: true, layout: 'GRID', stripExif: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().allowGuestDownload).toBe(true)
    expect(res.json().layout).toBe('GRID')
    expect(res.json().stripExif).toBe(false)
  })

  it('ignores non-allowlisted fields to prevent mass assignment', async () => {
    const db = getClient()
    await db.gallery.update({
      where: { id: galleryId },
      data: {
        isArchived: false,
        archivePath: null,
      },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: {
        name: 'Party Renamed',
        isArchived: true,
        archivePath: '/etc/passwd',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Party Renamed')

    const after = await db.gallery.findUniqueOrThrow({ where: { id: galleryId } })
    expect(after.isArchived).toBe(false)
    expect(after.archivePath).toBeNull()
  })

  it('returns 404 when the gallery does not exist', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/galleries/does-not-exist',
      headers: { cookie: sessionCookie },
      payload: { name: 'Missing Gallery' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().type).toBe('gallery-not-found')
  })

  it('returns 500 instead of masking unexpected failures as not-found', async () => {
    const hashSpy = vi.spyOn(bcrypt, 'hash').mockRejectedValueOnce(new Error('hash-fail'))
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/galleries/${galleryId}`,
        headers: { cookie: sessionCookie },
        payload: { secretKey: '2580' },
      })

      expect(res.statusCode).toBe(500)
      expect(res.json().type).toBe('internal-server-error')
    } finally {
      hashSpy.mockRestore()
    }
  })

  it('stores secretKey as bcrypt hash and never exposes it in responses', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: { secretKey: '2580' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).not.toHaveProperty('secretKey')

    const db = getClient()
    const gallery = await db.gallery.findUniqueOrThrow({ where: { id: galleryId } })
    expect(gallery.secretKey).toBeTruthy()
    expect(gallery.secretKey).not.toBe('2580')
    expect(await bcrypt.compare('2580', gallery.secretKey as string)).toBe(true)
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

describe('Gallery PIN access', () => {
  it('requires a valid PIN for protected guest gallery routes', async () => {
    const protect = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: { secretKey: '2468' },
    })
    expect(protect.statusCode).toBe(200)

    const blocked = await app.inject({ method: 'GET', url: '/api/v1/g/party' })
    expect(blocked.statusCode).toBe(401)
    expect(blocked.json().type).toBe('invalid-pin')

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/g/party/access',
      payload: { secretKey: '1111' },
    })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json().type).toBe('invalid-pin')

    const unlock = await app.inject({
      method: 'POST',
      url: '/api/v1/g/party/access',
      payload: { secretKey: '2468' },
    })
    expect(unlock.statusCode).toBe(200)
    const accessCookie = String(unlock.headers['set-cookie']).split(';')[0]
    expect(accessCookie).toContain('gallery_access_party=')
    expect(accessCookie).not.toContain('$2')

    const unlocked = await app.inject({
      method: 'GET',
      url: '/api/v1/g/party',
      headers: { cookie: accessCookie },
    })
    expect(unlocked.statusCode).toBe(200)
  })

  it('blocks PIN brute-force attempts after 10 failed attempts per IP', async () => {
    const protect = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: { secretKey: '9999' },
    })
    expect(protect.statusCode).toBe(200)

    for (let i = 0; i < 10; i += 1) {
      const wrong = await app.inject({
        method: 'POST',
        url: '/api/v1/g/party/access',
        remoteAddress: '10.5.5.5',
        payload: { secretKey: '0000' },
      })
      expect(wrong.statusCode).toBe(401)
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/g/party/access',
      remoteAddress: '10.5.5.5',
      payload: { secretKey: '0000' },
    })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().type).toBe('pin-attempts-exceeded')
  })

  it('does not reveal whether a slug exists on access endpoint', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/g/does-not-exist/access',
      payload: { secretKey: '1234' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().type).toBe('invalid-pin')
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
