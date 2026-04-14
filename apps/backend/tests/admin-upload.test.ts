import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = '/tmp/wps-admin-upload-test.db'

let app: FastifyInstance
let sessionCookie: string
let manualGalleryId: string
let autoGalleryId: string
let windowedGalleryId: string
let duplicateGalleryId: string

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  process.env.DATABASE_URL = `file:${DB_PATH}`
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = 'Password123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-admin-upload-test-storage'
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

  const manualGallery = await createGallery({
    weddingName: 'Admin Upload Manual',
    weddingSlug: 'admin-upload-manual',
    galleryName: 'Manual',
    gallerySlug: 'manual',
    moderationMode: 'MANUAL',
  })
  manualGalleryId = manualGallery.id

  const autoGallery = await createGallery({
    weddingName: 'Admin Upload Auto',
    weddingSlug: 'admin-upload-auto',
    galleryName: 'Auto',
    gallerySlug: 'auto',
    moderationMode: 'AUTO',
  })
  autoGalleryId = autoGallery.id

  const windowedGallery = await createGallery({
    weddingName: 'Admin Upload Windowed',
    weddingSlug: 'admin-upload-windowed',
    galleryName: 'Windowed',
    gallerySlug: 'windowed',
    moderationMode: 'MANUAL',
  })
  windowedGalleryId = windowedGallery.id

  await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/galleries/${windowedGalleryId}`,
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

  const duplicateGallery = await createGallery({
    weddingName: 'Admin Upload Duplicate',
    weddingSlug: 'admin-upload-duplicate',
    galleryName: 'Duplicate',
    gallerySlug: 'duplicate',
    moderationMode: 'MANUAL',
  })
  duplicateGalleryId = duplicateGallery.id
}, 30000)

afterAll(async () => {
  await app?.close()
  await closeClient()
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  if (fs.existsSync(`${DB_PATH}-shm`)) fs.unlinkSync(`${DB_PATH}-shm`)
  if (fs.existsSync(`${DB_PATH}-wal`)) fs.unlinkSync(`${DB_PATH}-wal`)
})

describe('POST /api/v1/admin/galleries/:id/upload', () => {
  it('rejects unauthenticated requests', async () => {
    const jpegBuf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#111111' },
    }).jpeg().toBuffer()

    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'unauthenticated.jpg')
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${manualGalleryId}/upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    })

    expect(res.statusCode).toBe(401)
  })

  it('allows an authenticated admin to upload an image', async () => {
    const jpegBuf = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#aabbcc' },
    }).jpeg().toBuffer()

    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'admin-upload.jpg')
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${manualGalleryId}/upload`,
      headers: {
        cookie: sessionCookie,
        'content-type': multipart.contentType,
      },
      payload: multipart.body,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().mediaType).toBe('IMAGE')
    expect(res.json().thumbUrl).toBeTruthy()
  })

  it('returns PENDING for MANUAL moderation galleries', async () => {
    const jpegBuf = await sharp({
      create: { width: 120, height: 120, channels: 3, background: '#223344' },
    }).jpeg().toBuffer()

    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'manual.jpg')
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${manualGalleryId}/upload`,
      headers: {
        cookie: sessionCookie,
        'content-type': multipart.contentType,
      },
      payload: multipart.body,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().status).toBe('PENDING')
  })

  it('returns APPROVED for AUTO moderation galleries', async () => {
    const jpegBuf = await sharp({
      create: { width: 160, height: 160, channels: 3, background: '#556677' },
    }).jpeg().toBuffer()

    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'auto.jpg')
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${autoGalleryId}/upload`,
      headers: {
        cookie: sessionCookie,
        'content-type': multipart.contentType,
      },
      payload: multipart.body,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().status).toBe('APPROVED')
  })

  it('auto-approves uploads in photographer mode even when gallery moderation is MANUAL', async () => {
    const jpegBuf = await sharp({
      create: { width: 200, height: 120, channels: 3, background: '#446688' },
    }).jpeg().toBuffer()

    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'photographer.jpg')
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${manualGalleryId}/upload?mode=photographer`,
      headers: {
        cookie: sessionCookie,
        'content-type': multipart.contentType,
      },
      payload: multipart.body,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().status).toBe('APPROVED')
  })

  it('ignores guest upload windows for admin uploads', async () => {
    const jpegBuf = await sharp({
      create: { width: 140, height: 140, channels: 3, background: '#778899' },
    }).jpeg().toBuffer()

    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'windowed.jpg')
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${windowedGalleryId}/upload`,
      headers: {
        cookie: sessionCookie,
        'content-type': multipart.contentType,
      },
      payload: multipart.body,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().status).toBe('PENDING')
  })

  it('returns 409 for duplicate uploads', async () => {
    const jpegBuf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#ff0000' },
    }).jpeg().toBuffer()

    const first = buildMultipartPayload(jpegBuf, 'image/jpeg', 'dup.jpg')
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${duplicateGalleryId}/upload`,
      headers: {
        cookie: sessionCookie,
        'content-type': first.contentType,
      },
      payload: first.body,
    })
    expect(res1.statusCode).toBe(201)

    const second = buildMultipartPayload(jpegBuf, 'image/jpeg', 'dup.jpg')
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${duplicateGalleryId}/upload`,
      headers: {
        cookie: sessionCookie,
        'content-type': second.contentType,
      },
      payload: second.body,
    })

    expect(res2.statusCode).toBe(409)
  })
})

async function createGallery(input: {
  weddingName: string
  weddingSlug: string
  galleryName: string
  gallerySlug: string
  moderationMode: 'MANUAL' | 'AUTO'
}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/galleries',
    headers: { cookie: sessionCookie },
    payload: input,
  })

  expect(res.statusCode).toBe(201)
  const body = res.json() as { id: string; slug: string }
  return body
}

function buildMultipartPayload(fileBuffer: Buffer, mimeType: string, filename: string) {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2)
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}
