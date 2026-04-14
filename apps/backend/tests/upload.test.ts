import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { UploadNotifier } from '../src/services/uploadNotifier.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = '/tmp/wps-upload-test.db'

let app: FastifyInstance
let sessionCookie: string
let gallerySlug: string
let galleryId: string
const notifyGuestUpload = vi.fn<UploadNotifier['notifyGuestUpload']>().mockResolvedValue(undefined)

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  process.env.DATABASE_URL = `file:${DB_PATH}`
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = 'Password123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-upload-test-storage'
  process.env.NODE_ENV = 'test'

  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '../../../packages/db'),
    env: { ...process.env },
    stdio: 'inherit',
  })

  const config = loadConfig()
  app = await buildApp(config, {
    uploadNotifier: { notifyGuestUpload },
  })
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
    payload: {
      weddingName: 'Upload Test Wedding',
      weddingSlug: 'upload-test-wedding',
      galleryName: 'Uploads',
      gallerySlug: 'uploads',
    },
  })
  galleryId = createRes.json().id
  gallerySlug = createRes.json().slug
}, 30000)

afterAll(async () => {
  await app?.close()
  await closeClient()
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  if (fs.existsSync(`${DB_PATH}-shm`)) fs.unlinkSync(`${DB_PATH}-shm`)
  if (fs.existsSync(`${DB_PATH}-wal`)) fs.unlinkSync(`${DB_PATH}-wal`)
})

beforeEach(() => {
  notifyGuestUpload.mockClear()
})

describe('POST /api/v1/g/:slug/upload', () => {
  it('accepts a valid JPEG and returns PENDING status', async () => {
    const jpegBuf = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#aabbcc' },
    }).jpeg().toBuffer()

    const { body, contentType } = buildMultipartPayload(jpegBuf, 'image/jpeg', 'test.jpg')
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(201)
    const body2 = res.json()
    expect(body2.status).toBe('PENDING')
    expect(body2.mediaType).toBe('IMAGE')
    expect(body2.thumbUrl).toBeTruthy()
    expect(typeof body2.deleteToken).toBe('string')
    expect((body2.deleteToken as string).length).toBeGreaterThan(20)
    expect(notifyGuestUpload).toHaveBeenCalledTimes(1)
    expect(notifyGuestUpload).toHaveBeenCalledWith(expect.objectContaining({
      gallerySlug,
      mediaType: 'IMAGE',
      status: 'PENDING',
      photoId: body2.id,
    }))
  })

  it('returns 409 on duplicate upload (same file)', async () => {
    const jpegBuf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#ff0000' },
    }).jpeg().toBuffer()

    const p1 = buildMultipartPayload(jpegBuf, 'image/jpeg', 'dup.jpg')
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': p1.contentType },
      payload: p1.body,
    })
    expect(res1.statusCode).toBe(201)

    const p2 = buildMultipartPayload(jpegBuf, 'image/jpeg', 'dup.jpg')
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': p2.contentType },
      payload: p2.body,
    })
    expect(res2.statusCode).toBe(409)
    expect(res2.json().type).toContain('duplicate')
  })

  it('returns 415 for disallowed MIME type', async () => {
    const { body, contentType } = buildMultipartPayload(
      Buffer.from('<html>attack</html>'),
      'text/html',
      'bad.html'
    )
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(415)
  })

  it('rejects guest names that exceed the maximum length', async () => {
    const jpegBuf = await sharp({
      create: { width: 120, height: 120, channels: 3, background: '#aa66cc' },
    }).jpeg().toBuffer()

    const { body, contentType } = buildMultipartPayload(
      jpegBuf,
      'image/jpeg',
      'too-long-name.jpg',
      { guestName: 'x'.repeat(81) }
    )
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().type).toBe('guest-name-too-long')
    expect(notifyGuestUpload).not.toHaveBeenCalled()
  })

  it('rejects uploads outside configured windows', async () => {
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

    const jpegBuf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#00ff00' },
    }).jpeg().toBuffer()

    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'closed.jpg')
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().type).toBe('upload-window-closed')
  })

  it('requires gallery PIN before guest uploads when secretKey is configured', async () => {
    const protect = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: { secretKey: '1357', uploadWindows: [] },
    })
    expect(protect.statusCode).toBe(200)

    const jpegBuf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#112233' },
    }).jpeg().toBuffer()
    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'protected.jpg')

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    })
    expect(blocked.statusCode).toBe(401)
    expect(blocked.json().type).toBe('invalid-pin')

    const unlock = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/access`,
      payload: { secretKey: '1357' },
    })
    expect(unlock.statusCode).toBe(200)
    const accessCookie = String(unlock.headers['set-cookie']).split(';')[0]

    const allowed = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: {
        'content-type': multipart.contentType,
        cookie: accessCookie,
      },
      payload: multipart.body,
    })
    expect(allowed.statusCode).toBe(201)
  })

  it('requires admin auth for original file access when guest download is disabled', async () => {
    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: {
        secretKey: null,
        uploadWindows: [],
        allowGuestDownload: false,
      },
    })
    expect(reset.statusCode).toBe(200)

    const jpegBuf = await sharp({
      create: { width: 120, height: 120, channels: 3, background: '#334455' },
    }).jpeg().toBuffer()
    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'original-protected.jpg')
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    })
    expect(upload.statusCode).toBe(201)
    const photoId = upload.json().id as string

    const blocked = await app.inject({
      method: 'GET',
      url: `/api/v1/files/${gallerySlug}/${photoId}?v=original`,
    })
    expect(blocked.statusCode).toBe(401)
    expect(blocked.json().type).toBe('unauthorized')

    const allowed = await app.inject({
      method: 'GET',
      url: `/api/v1/files/${gallerySlug}/${photoId}?v=original`,
      headers: { cookie: sessionCookie },
    })
    expect(allowed.statusCode).toBe(200)
  })

  it('requires admin auth for non-approved media access and allows admins to access pending files', async () => {
    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: {
        secretKey: null,
        uploadWindows: [],
      },
    })
    expect(reset.statusCode).toBe(200)

    const jpegBuf = await sharp({
      create: { width: 120, height: 120, channels: 3, background: '#225577' },
    }).jpeg().toBuffer()
    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'pending-access.jpg')
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    })
    expect(upload.statusCode).toBe(201)
    expect(upload.json().status).toBe('PENDING')
    const photoId = upload.json().id as string

    const guestBlocked = await app.inject({
      method: 'GET',
      url: `/api/v1/files/${gallerySlug}/${photoId}?v=display`,
    })
    expect(guestBlocked.statusCode).toBe(401)
    expect(guestBlocked.json().type).toBe('unauthorized')

    const adminAllowed = await app.inject({
      method: 'GET',
      url: `/api/v1/files/${gallerySlug}/${photoId}?v=display`,
      headers: { cookie: sessionCookie },
    })
    expect(adminAllowed.statusCode).toBe(200)
  })

  it('allows deleting pending uploads with a valid delete token', async () => {
    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: {
        secretKey: null,
        uploadWindows: [],
      },
    })
    expect(reset.statusCode).toBe(200)

    const jpegBuf = await sharp({
      create: { width: 120, height: 120, channels: 3, background: '#4488aa' },
    }).jpeg().toBuffer()
    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'pending-delete.jpg')
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    })
    expect(upload.statusCode).toBe(201)

    const uploadBody = upload.json() as {
      id: string
      status: 'PENDING' | 'APPROVED'
      deleteToken?: string
    }
    expect(uploadBody.status).toBe('PENDING')
    expect(typeof uploadBody.deleteToken).toBe('string')

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/g/${gallerySlug}/uploads/${uploadBody.id}`,
      payload: { deleteToken: uploadBody.deleteToken },
    })
    expect(deleteRes.statusCode).toBe(200)
    expect(deleteRes.json()).toEqual({ ok: true })

    const fileAfterDelete = await app.inject({
      method: 'GET',
      url: `/api/v1/files/${gallerySlug}/${uploadBody.id}?v=display`,
      headers: { cookie: sessionCookie },
    })
    expect(fileAfterDelete.statusCode).toBe(404)
  })

  it('returns 404 when file exists in db but is missing on disk', async () => {
    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: {
        secretKey: null,
        uploadWindows: [],
      },
    })
    expect(reset.statusCode).toBe(200)

    const jpegBuf = await sharp({
      create: { width: 120, height: 120, channels: 3, background: '#999999' },
    }).jpeg().toBuffer()
    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'missing-file.jpg')
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    })
    expect(upload.statusCode).toBe(201)
    const photoId = upload.json().id as string

    const db = getClient()
    const photo = await db.photo.findUniqueOrThrow({ where: { id: photoId } })
    await unlink(path.join('/tmp/wps-upload-test-storage', gallerySlug, photo.displayPath))

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/files/${gallerySlug}/${photoId}?v=display`,
      headers: { cookie: sessionCookie },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().type).toBe('not-found')
  })

  it('rejects invalid photo ids in files route params', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/files/${gallerySlug}/photo_%22bad%22?v=display`,
      headers: { cookie: sessionCookie },
    })

    expect(res.statusCode).toBe(400)
  })
})

function buildMultipartPayload(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string,
  fields: Record<string, string> = {}
) {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2)
  const fieldParts = Object.entries(fields).map(([key, value]) => Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
  ))
  const body = Buffer.concat([
    ...fieldParts,
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}
