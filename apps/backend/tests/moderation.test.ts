import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import type { SseManager } from '../src/services/sse.js'
import { createBackendTestEnv, type BackendTestEnv } from './helpers/backendTestEnv.js'

let app: FastifyInstance
let sessionCookie: string
let gallerySlug: string
let photoId: string
let testEnv: BackendTestEnv
const sseBroadcast = vi.fn<SseManager['broadcast']>().mockResolvedValue(undefined)

beforeAll(async () => {
  testEnv = await createBackendTestEnv('moderation')

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
    payload: { weddingName: 'Mod Test', weddingSlug: 'mod-test', galleryName: 'Mod', gallerySlug: 'mod' },
  })
  gallerySlug = createRes.json().slug

  // Upload a photo to moderate
  const jpegBuf = await sharp({
    create: { width: 100, height: 100, channels: 3, background: '#123456' },
  }).jpeg().toBuffer()

  const initialUpload = buildMultipartPayload(jpegBuf, 'image/jpeg', 'mod-test.jpg')

  const uploadRes = await app.inject({
    method: 'POST',
    url: `/api/v1/g/${gallerySlug}/upload`,
    headers: { 'content-type': initialUpload.contentType },
    payload: initialUpload.body,
  })
  photoId = uploadRes.json().id
})

afterAll(async () => {
  await app?.close()
  await closeClient()
  await testEnv.cleanup()
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
    sseBroadcast.mockClear()

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/photos/${photoId}`,
      headers: { cookie: sessionCookie },
      payload: { status: 'APPROVED' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('APPROVED')
    expect(sseBroadcast).toHaveBeenCalledTimes(1)
    expect(sseBroadcast).toHaveBeenCalledWith(expect.any(String), 'new-photo', expect.objectContaining({
      id: photoId,
    }))
  })

  it('returns 404 when approving a non-existing photo', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/photos/does-not-exist',
      headers: { cookie: sessionCookie },
      payload: { status: 'APPROVED' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().type).toBe('photo-not-found')
  })
})

describe('DELETE /api/v1/admin/photos/:id', () => {
  it('soft-deletes a photo so it no longer appears in admin listings', async () => {
    const buf = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#9966aa' },
    }).jpeg().toBuffer()
    const multipart = buildMultipartPayload(buf, 'image/jpeg', 'soft-delete.jpg')
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    })
    expect(upload.statusCode).toBe(201)
    const uploadedId = upload.json().id as string

    const gallery = await getClient().gallery.findFirstOrThrow({ where: { slug: gallerySlug } })
    const listedBefore = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/galleries/${gallery.id}/photos?status=PENDING`,
      headers: { cookie: sessionCookie },
    })
    expect(listedBefore.statusCode).toBe(200)
    expect((listedBefore.json().data as Array<{ id: string }>).some((photo) => photo.id === uploadedId)).toBe(true)

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/photos/${uploadedId}`,
      headers: { cookie: sessionCookie },
    })
    expect(deleteRes.statusCode).toBe(200)
    expect(deleteRes.json()).toEqual({ ok: true })

    const listedAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/galleries/${gallery.id}/photos?status=PENDING`,
      headers: { cookie: sessionCookie },
    })
    expect(listedAfter.statusCode).toBe(200)
    expect((listedAfter.json().data as Array<{ id: string }>).some((photo) => photo.id === uploadedId)).toBe(false)
  })

  it('returns 404 when deleting a non-existing photo', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/photos/does-not-exist',
      headers: { cookie: sessionCookie },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().type).toBe('photo-not-found')
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
      const multipart = buildMultipartPayload(buf, 'image/jpeg', `batch${i}.jpg`)
      const r = await app.inject({
        method: 'POST',
        url: `/api/v1/g/${gallerySlug}/upload`,
        headers: { 'content-type': multipart.contentType },
        payload: multipart.body,
      })
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

  it('approves multiple photos and broadcasts one SSE event per approved photo', async () => {
    sseBroadcast.mockClear()

    const ids: string[] = []
    for (let i = 0; i < 2; i += 1) {
      const buf = await sharp({
        create: { width: 80, height: 80, channels: 3, background: `#22${i}${i}aa` },
      }).jpeg().toBuffer()
      const multipart = buildMultipartPayload(buf, 'image/jpeg', `batch-approve-${i}.jpg`)
      const upload = await app.inject({
        method: 'POST',
        url: `/api/v1/g/${gallerySlug}/upload`,
        headers: { 'content-type': multipart.contentType },
        payload: multipart.body,
      })
      expect(upload.statusCode).toBe(201)
      ids.push(upload.json().id)
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/photos/batch',
      headers: { cookie: sessionCookie },
      payload: { action: 'approve', photoIds: ids },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().processed).toBe(2)
    expect(sseBroadcast).toHaveBeenCalledTimes(2)
    expect(sseBroadcast).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      'new-photo',
      expect.objectContaining({ id: ids[0] })
    )
    expect(sseBroadcast).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      'new-photo',
      expect.objectContaining({ id: ids[1] })
    )
  })
})

function buildMultipartPayload(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string,
  fields: Record<string, string> = {}
) {
  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`
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
