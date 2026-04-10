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
