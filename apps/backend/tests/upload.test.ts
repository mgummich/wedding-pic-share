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
const DB_PATH = '/tmp/wps-upload-test.db'

let app: FastifyInstance
let sessionCookie: string
let gallerySlug: string
let galleryId: string

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
})

function buildMultipartPayload(fileBuffer: Buffer, mimeType: string, filename: string) {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2)
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}
