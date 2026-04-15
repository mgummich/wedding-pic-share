import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import { createBackendTestEnv, type BackendTestEnv } from './helpers/backendTestEnv.js'

const DOWNLOAD_LIMIT = 5000

let app: FastifyInstance
let testEnv: BackendTestEnv
let gallerySlug: string

beforeAll(async () => {
  testEnv = await createBackendTestEnv('guest-download-limits')
  app = await buildApp(loadConfig())
  await app.ready()

  const db = getClient()
  const wedding = await db.wedding.create({
    data: { name: 'Download Test Wedding', slug: 'download-test-wedding' },
  })
  const gallery = await db.gallery.create({
    data: {
      weddingId: wedding.id,
      name: 'Download Test Gallery',
      slug: 'download-test-gallery',
      allowGuestDownload: true,
    },
  })
  gallerySlug = gallery.slug

  const baseCreatedAt = new Date('2038-01-01T00:00:00.000Z')
  const rows = Array.from({ length: DOWNLOAD_LIMIT + 1 }, (_, idx) => ({
    id: `download_limit_${idx}`,
    galleryId: gallery.id,
    fileHash: `download-limit-hash-${idx}`,
    mediaType: 'IMAGE' as const,
    originalPath: `download_limit_${idx}_original.webp`,
    thumbPath: `download_limit_${idx}_thumb.webp`,
    displayPath: `download_limit_${idx}_display.webp`,
    mimeType: 'image/webp',
    status: 'APPROVED' as const,
    blurDataUrl: '',
    exifStripped: true,
    createdAt: new Date(baseCreatedAt.getTime() + idx * 1000),
  }))
  await db.photo.createMany({ data: rows })
})

afterAll(async () => {
  await app.close()
  await closeClient()
  await testEnv.cleanup()
})

describe('GET /api/v1/g/:slug/download limits', () => {
  it('returns 413 when approved photo count exceeds guest download safety limit', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/g/${gallerySlug}/download`,
    })

    expect(res.statusCode).toBe(413)
    expect(res.json().type).toBe('download-too-large')
  })
})
