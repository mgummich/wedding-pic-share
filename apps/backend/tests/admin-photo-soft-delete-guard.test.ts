import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { seedAdmin } from '../src/seed.js'
import { closeClient, getClient } from '@wedding/db'
import { createBackendTestEnv, type BackendTestEnv } from './helpers/backendTestEnv.js'

let app: FastifyInstance
let testEnv: BackendTestEnv
let galleryId: string
let existingPhotoId: string
let deletedPhotoId: string
let adminCookie: string
let csrfCookie: string
let csrfToken: string

function firstCookie(raw: string | string[] | undefined): string {
  if (!raw) return ''
  if (Array.isArray(raw)) return raw[0].split(';')[0]
  return raw.split(';')[0]
}

beforeAll(async () => {
  testEnv = await createBackendTestEnv('admin-photo-soft-delete-guard')
  const config = loadConfig()
  app = await buildApp(config)
  await app.ready()
  await seedAdmin(config)

  const db = getClient()
  const wedding = await db.wedding.create({
    data: { name: 'Moderation Guard Wedding', slug: 'moderation-guard-wedding' },
  })
  const gallery = await db.gallery.create({
    data: {
      weddingId: wedding.id,
      name: 'Moderation Guard Gallery',
      slug: 'moderation-guard-gallery',
    },
  })
  galleryId = gallery.id

  const now = new Date('2038-02-01T00:00:00.000Z')
  const existingPhoto = await db.photo.create({
    data: {
      id: 'guard_existing_photo',
      galleryId: gallery.id,
      fileHash: 'guard-existing-hash',
      mediaType: 'IMAGE',
      originalPath: 'guard_existing_original.webp',
      thumbPath: 'guard_existing_thumb.webp',
      displayPath: 'guard_existing_display.webp',
      mimeType: 'image/webp',
      status: 'PENDING',
      blurDataUrl: '',
      exifStripped: true,
      createdAt: now,
    },
  })
  existingPhotoId = existingPhoto.id

  const deletedPhoto = await db.photo.create({
    data: {
      id: 'guard_deleted_photo',
      galleryId: gallery.id,
      fileHash: 'guard-deleted-hash',
      mediaType: 'IMAGE',
      originalPath: 'guard_deleted_original.webp',
      thumbPath: 'guard_deleted_thumb.webp',
      displayPath: 'guard_deleted_display.webp',
      mimeType: 'image/webp',
      status: 'PENDING',
      blurDataUrl: '',
      exifStripped: true,
      deletedAt: new Date(now.getTime() + 1_000),
      createdAt: new Date(now.getTime() + 1_000),
    },
  })
  deletedPhotoId = deletedPhoto.id

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/login',
    payload: { username: 'admin', password: 'Password123!' },
  })
  adminCookie = firstCookie(login.headers['set-cookie'])

  const csrf = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/csrf',
    headers: { cookie: adminCookie },
  })
  csrfToken = csrf.json().csrfToken as string
  csrfCookie = firstCookie(csrf.headers['set-cookie'])
})

afterAll(async () => {
  await app.close()
  await closeClient()
  await testEnv.cleanup()
})

describe('admin photo moderation soft-delete guards', () => {
  it('returns 404 when moderating a soft-deleted photo', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/photos/${deletedPhotoId}`,
      headers: {
        cookie: `${adminCookie}; ${csrfCookie}`,
        'x-csrf-token': csrfToken,
      },
      payload: { status: 'APPROVED' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().type).toBe('photo-not-found')
  })

  it('reports failed ids in batch moderation when a photo is soft-deleted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/photos/batch',
      headers: {
        cookie: `${adminCookie}; ${csrfCookie}`,
        'x-csrf-token': csrfToken,
      },
      payload: {
        action: 'approve',
        photoIds: [existingPhotoId, deletedPhotoId, 'guard_missing_photo'],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().processed).toBe(1)
    expect(res.json().failed).toEqual([deletedPhotoId, 'guard_missing_photo'])
  })

  it('returns 404 when deleting an already soft-deleted photo', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/photos/${deletedPhotoId}`,
      headers: {
        cookie: `${adminCookie}; ${csrfCookie}`,
        'x-csrf-token': csrfToken,
      },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().type).toBe('photo-not-found')
  })

  it('still allows listing non-deleted photos in the requested status bucket', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/galleries/${galleryId}/photos?status=APPROVED`,
      headers: {
        cookie: adminCookie,
      },
    })

    expect(res.statusCode).toBe(200)
    const ids = (res.json().data as Array<{ id: string }>).map((photo) => photo.id)
    expect(ids).toContain(existingPhotoId)
    expect(ids).not.toContain(deletedPhotoId)
  })
})
