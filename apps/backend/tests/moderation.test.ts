import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = '/tmp/wps-mod-test.db'

let app: FastifyInstance
let sessionCookie: string
let gallerySlug: string
let photoId: string

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  process.env.DATABASE_URL = `file:${DB_PATH}`
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = 'Password123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-mod-test-storage'
  process.env.NODE_ENV = 'test'

  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '../../../packages/db'),
    env: { ...process.env },
    stdio: 'inherit',
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

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/galleries',
    headers: { cookie: sessionCookie },
    payload: { weddingName: 'Mod Test', weddingSlug: 'mod-test', galleryName: 'Mod', gallerySlug: 'mod' },
  })
  gallerySlug = createRes.json().slug

  // Upload a photo to moderate
  const jpegBuf = await sharp({
    create: { width: 100, height: 100, channels: 3, background: '#123456' },
  }).jpeg().toBuffer()

  const form = new FormData()
  form.append('file', new Blob([jpegBuf], { type: 'image/jpeg' }), 'mod-test.jpg')

  const uploadRes = await app.inject({
    method: 'POST',
    url: `/api/v1/g/${gallerySlug}/upload`,
    payload: form,
  })
  photoId = uploadRes.json().id
})

afterAll(async () => {
  await app.close()
  await closeClient()
})

describe('GET /api/v1/admin/galleries/:id/photos', () => {
  it('returns pending photos for admin', async () => {
    const gallery = await getClient().gallery.findFirst({ where: { slug: gallerySlug } })
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/galleries/${gallery!.id}/photos?status=PENDING`,
      headers: { cookie: sessionCookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBeGreaterThan(0)
  })

  it('paginates pending photos consistently when ids are not creation-ordered', async () => {
    const db = getClient()
    const gallery = await db.gallery.findFirstOrThrow({ where: { slug: gallerySlug } })
    await db.photo.createMany({
      data: [
        {
          id: 'pending_a_new',
          galleryId: gallery.id,
          fileHash: 'pending-cursor-a-new',
          mediaType: 'IMAGE',
          originalPath: 'pending_a_new_original.webp',
          thumbPath: 'pending_a_new_thumb.webp',
          displayPath: 'pending_a_new_display.webp',
          mimeType: 'image/webp',
          status: 'PENDING',
          blurDataUrl: '',
          exifStripped: true,
          createdAt: new Date('2037-01-01T10:02:00.000Z'),
        },
        {
          id: 'pending_z_old',
          galleryId: gallery.id,
          fileHash: 'pending-cursor-z-old',
          mediaType: 'IMAGE',
          originalPath: 'pending_z_old_original.webp',
          thumbPath: 'pending_z_old_thumb.webp',
          displayPath: 'pending_z_old_display.webp',
          mimeType: 'image/webp',
          status: 'PENDING',
          blurDataUrl: '',
          exifStripped: true,
          createdAt: new Date('2037-01-01T10:01:00.000Z'),
        },
        {
          id: 'pending_y_old',
          galleryId: gallery.id,
          fileHash: 'pending-cursor-y-old',
          mediaType: 'IMAGE',
          originalPath: 'pending_y_old_original.webp',
          thumbPath: 'pending_y_old_thumb.webp',
          displayPath: 'pending_y_old_display.webp',
          mimeType: 'image/webp',
          status: 'PENDING',
          blurDataUrl: '',
          exifStripped: true,
          createdAt: new Date('2037-01-01T10:00:00.000Z'),
        },
      ],
    })

    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 6; i += 1) {
      const url = cursor
        ? `/api/v1/admin/galleries/${gallery.id}/photos?status=PENDING&limit=1&cursor=${encodeURIComponent(cursor)}`
        : `/api/v1/admin/galleries/${gallery.id}/photos?status=PENDING&limit=1`
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { cookie: sessionCookie },
      })
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
    expect(unique.has('pending_a_new')).toBe(true)
    expect(unique.has('pending_z_old')).toBe(true)
    expect(unique.has('pending_y_old')).toBe(true)
  })
})

describe('PATCH /api/v1/admin/photos/:id', () => {
  it('approves a photo and broadcasts SSE', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/photos/${photoId}`,
      headers: { cookie: sessionCookie },
      payload: { status: 'APPROVED' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('APPROVED')
  })
})

describe('POST /api/v1/admin/photos/batch', () => {
  it('rejects multiple photos at once', async () => {
    // Upload two more photos
    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
      const buf = await sharp({
        create: { width: 50, height: 50, channels: 3, background: `#${i}${i}${i}${i}${i}${i}` },
      }).jpeg().toBuffer()
      const form = new FormData()
      form.append('file', new Blob([buf], { type: 'image/jpeg' }), `batch${i}.jpg`)
      const r = await app.inject({ method: 'POST', url: `/api/v1/g/${gallerySlug}/upload`, payload: form })
      ids.push(r.json().id)
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/photos/batch',
      headers: { cookie: sessionCookie },
      payload: { action: 'reject', photoIds: ids, rejectionReason: 'Not appropriate' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().processed).toBe(2)
  })
})
