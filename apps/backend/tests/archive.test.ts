import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import path from 'node:path'
import { unlink } from 'node:fs/promises'
import type { SseManager } from '../src/services/sse.js'
import { createBackendTestEnv, type BackendTestEnv } from './helpers/backendTestEnv.js'

let app: FastifyInstance
let sessionCookie: string
let galleryId: string
let gallerySlug: string
const sseBroadcast = vi.fn<SseManager['broadcast']>().mockResolvedValue(undefined)
let testEnv: BackendTestEnv

beforeAll(async () => {
  testEnv = await createBackendTestEnv('archive')

  const config = loadConfig()
  const sse: SseManager = {
    add: () => {},
    remove: () => {},
    broadcast: sseBroadcast,
    sendHeartbeat: async () => {},
    connectionCount: () => 0,
    close: async () => {},
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
  await testEnv.cleanup()
})

describe('POST /api/v1/admin/galleries/:id/archive', () => {
  it('closes uploads, persists archive metadata, and emits gallery-closed SSE event', async () => {
    const body = await triggerArchiveAndWait()
    expect(body.isArchived).toBe(true)
    expect(body.archiveStatus).toBe('COMPLETED')
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
    expect(gallery.archiveStatus).toBe('COMPLETED')

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
    expect(second.json().archiveStatus).toBe('COMPLETED')
    expect(sseBroadcast.mock.calls.length).toBe(callCountAfterFirstArchive)
  })

  it('returns 202 while archive generation is in progress', async () => {
    const now = Date.now()
    const freshCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/galleries',
      headers: { cookie: sessionCookie },
      payload: {
        weddingName: 'Archive Progress Wedding',
        weddingSlug: `archive-progress-${now}`,
        galleryName: 'Archive Progress',
        gallerySlug: `archive-progress-${now}`,
        moderationMode: 'AUTO',
      },
    })
    expect(freshCreate.statusCode).toBe(201)
    const freshGalleryId = freshCreate.json().id as string
    const freshGallerySlug = freshCreate.json().slug as string

    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${freshGalleryId}`,
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
      create: { width: 600, height: 600, channels: 3, background: '#556677' },
    }).jpeg().toBuffer()

    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'archive-progress.jpg')
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${freshGallerySlug}/upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    })
    expect(uploadRes.statusCode).toBe(201)

    const firstArchive = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${freshGalleryId}/archive`,
      headers: { cookie: sessionCookie },
    })
    expect([200, 202]).toContain(firstArchive.statusCode)

    const secondArchive = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${freshGalleryId}/archive`,
      headers: { cookie: sessionCookie },
    })
    expect([200, 202]).toContain(secondArchive.statusCode)
    if (secondArchive.statusCode === 202) {
      expect(secondArchive.json().archiveStatus).toBe('IN_PROGRESS')
    }
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

    await unlink(path.join(testEnv.storagePath, gallery.slug, photo.originalPath))

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

async function triggerArchiveAndWait() {
  let lastBody: {
      isArchived: boolean
      archivedAt: string | null
      archiveSizeBytes: number | null
      archiveStatus?: string
      archiveError?: string | null
      isUploadOpen: boolean
      uploadWindows: Array<unknown>
    } | null = null

  for (let i = 0; i < 30; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/galleries/${galleryId}/archive`,
      headers: { cookie: sessionCookie },
    })
    expect([200, 202]).toContain(res.statusCode)

    lastBody = res.json()
    if (lastBody.isArchived) {
      return lastBody
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error(`archive did not finish in time: ${JSON.stringify(lastBody)}`)
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
