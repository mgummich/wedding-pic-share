import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unlink } from 'node:fs/promises'
import type { SseManager } from '../src/services/sse.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = '/tmp/wps-archive-test.db'
const STORAGE_PATH = '/tmp/wps-archive-test-storage'

let app: FastifyInstance
let sessionCookie: string
let galleryId: string
let gallerySlug: string
const sseBroadcast = vi.fn<SseManager['broadcast']>()

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  if (fs.existsSync(STORAGE_PATH)) fs.rmSync(STORAGE_PATH, { recursive: true, force: true })

  process.env.DATABASE_URL = `file:${DB_PATH}`
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = 'Password123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = STORAGE_PATH
  process.env.NODE_ENV = 'test'

  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '../../../packages/db'),
    env: { ...process.env },
    stdio: 'inherit',
  })

  const config = loadConfig()
  const sse: SseManager = {
    add: () => {},
    remove: () => {},
    broadcast: sseBroadcast,
    sendHeartbeat: () => {},
    connectionCount: () => 0,
  }
  app = await buildApp(config, { sse })
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
      weddingName: 'Archive Test Wedding',
      weddingSlug: 'archive-test-wedding',
      galleryName: 'Archive Gallery',
      gallerySlug: 'archive-gallery',
      moderationMode: 'AUTO',
    },
  })
  expect(createRes.statusCode).toBe(201)
  galleryId = createRes.json().id
  gallerySlug = createRes.json().slug

  const now = Date.now()
  const updateRes = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/galleries/${galleryId}`,
    headers: { cookie: sessionCookie },
    payload: {
      uploadWindows: [
        {
          start: new Date(now - 60_000).toISOString(),
          end: new Date(now + 60 * 60_000).toISOString(),
        },
      ],
    },
  })
  expect(updateRes.statusCode).toBe(200)

  const jpegBuf = await sharp({
    create: { width: 300, height: 200, channels: 3, background: '#445566' },
  }).jpeg().toBuffer()

  const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'archive-source.jpg')
  const uploadRes = await app.inject({
    method: 'POST',
    url: `/api/v1/g/${gallerySlug}/upload`,
    headers: { 'content-type': multipart.contentType },
    payload: multipart.body,
  })
  expect(uploadRes.statusCode).toBe(201)
  expect(uploadRes.json().status).toBe('APPROVED')
}, 30_000)

afterAll(async () => {
  await app?.close()
  await closeClient()
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  if (fs.existsSync(`${DB_PATH}-shm`)) fs.unlinkSync(`${DB_PATH}-shm`)
  if (fs.existsSync(`${DB_PATH}-wal`)) fs.unlinkSync(`${DB_PATH}-wal`)
  if (fs.existsSync(STORAGE_PATH)) fs.rmSync(STORAGE_PATH, { recursive: true, force: true })
})

describe('POST /api/v1/admin/galleries/:id/archive', () => {
  it('closes uploads, persists archive metadata, and emits gallery-closed SSE event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${galleryId}/archive`,
      headers: { cookie: sessionCookie },
    })

    expect(res.statusCode).toBe(200)

    const body = res.json() as {
      isArchived: boolean
      archivedAt: string | null
      archiveSizeBytes: number | null
      isUploadOpen: boolean
      uploadWindows: Array<unknown>
    }

    expect(body.isArchived).toBe(true)
    expect(typeof body.archivedAt).toBe('string')
    expect(body.archiveSizeBytes).toBeGreaterThan(0)
    expect(body.isUploadOpen).toBe(false)
    expect(body.uploadWindows).toHaveLength(0)

    const db = getClient()
    const gallery = await db.gallery.findUniqueOrThrow({ where: { id: galleryId } })
    expect(gallery.isArchived).toBe(true)
    expect(gallery.archivedAt).toBeTruthy()
    expect(gallery.archivePath).toBeTruthy()
    expect(gallery.archiveSizeBytes).toBeGreaterThan(0)

    expect(sseBroadcast).toHaveBeenCalledWith(
      galleryId,
      'gallery-closed',
      expect.objectContaining({ reason: 'archived' })
    )

    const callCountAfterFirstArchive = sseBroadcast.mock.calls.length
    const archivedAtFirst = body.archivedAt
    const sizeFirst = body.archiveSizeBytes

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${galleryId}/archive`,
      headers: { cookie: sessionCookie },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().archivedAt).toBe(archivedAtFirst)
    expect(second.json().archiveSizeBytes).toBe(sizeFirst)
    expect(sseBroadcast.mock.calls.length).toBe(callCountAfterFirstArchive)
  })

  it('blocks subsequent guest uploads for archived galleries', async () => {
    const jpegBuf = await sharp({
      create: { width: 120, height: 120, channels: 3, background: '#778899' },
    }).jpeg().toBuffer()

    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'blocked-after-archive.jpg')
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().type).toBe('gallery-archived')
  })

  it('serves persisted archive from export endpoint without rebuilding from originals', async () => {
    const db = getClient()
    const gallery = await db.gallery.findUniqueOrThrow({ where: { id: galleryId } })
    const photo = await db.photo.findFirstOrThrow({
      where: { galleryId, status: 'APPROVED', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })

    await unlink(path.join(STORAGE_PATH, gallery.slug, photo.originalPath))

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/galleries/${galleryId}/export`,
      headers: { cookie: sessionCookie },
    })

    expect(res.statusCode).toBe(200)
    expect(String(res.headers['content-type'])).toContain('application/zip')
    expect(String(res.headers['content-disposition'])).toContain(`${gallery.slug}-export.zip`)
    expect(res.rawPayload.length).toBeGreaterThan(100)
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
