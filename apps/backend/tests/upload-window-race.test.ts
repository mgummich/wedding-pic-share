import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import { processImage, processVideo } from '../src/services/media.js'
import type { MediaProcessor } from '../src/services/mediaProcessor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = '/tmp/wps-upload-window-race-test.db'

let app: FastifyInstance
let sessionCookie: string
let galleryId: string
let gallerySlug: string

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  process.env.DATABASE_URL = `file:${DB_PATH}`
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = 'Password123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-upload-window-race-storage'
  process.env.NODE_ENV = 'test'

  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '../../../packages/db'),
    env: { ...process.env },
    stdio: 'inherit',
  })

  const delayedProcessor: MediaProcessor = {
    processImage: async (inputBuffer, mimeType, options) => {
      await sleep(120)
      return processImage(inputBuffer, mimeType, options)
    },
    processVideo: async (inputBuffer) => {
      await sleep(120)
      return processVideo(inputBuffer)
    },
    close: async () => {},
  }

  const appConfig = loadConfig()
  app = await buildApp(appConfig, {
    mediaProcessor: delayedProcessor,
    uploadNotifier: {
      notifyGuestUpload: async () => {},
    },
  })
  await app.ready()

  const { seedAdmin } = await import('../src/seed.js')
  await seedAdmin(appConfig)

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
      weddingName: 'Race Wedding',
      weddingSlug: 'race-wedding',
      galleryName: 'Race Gallery',
      gallerySlug: 'race-gallery',
      moderationMode: 'MANUAL',
    },
  })
  expect(createRes.statusCode).toBe(201)
  galleryId = createRes.json().id
  gallerySlug = createRes.json().slug
}, 30_000)

afterAll(async () => {
  await app?.close()
  await closeClient()
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  if (fs.existsSync(`${DB_PATH}-shm`)) fs.unlinkSync(`${DB_PATH}-shm`)
  if (fs.existsSync(`${DB_PATH}-wal`)) fs.unlinkSync(`${DB_PATH}-wal`)
})

describe('upload window race condition', () => {
  it('rejects upload when window closes during processing before persistence', async () => {
    const now = Date.now()
    const openWindow = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: {
        uploadWindows: [
          {
            start: new Date(now - 60_000).toISOString(),
            end: new Date(now + 60_000).toISOString(),
          },
        ],
      },
    })
    expect(openWindow.statusCode).toBe(200)

    const jpegBuf = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: '#335577' },
    }).jpeg().toBuffer()
    const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'race-window.jpg')

    const uploadPromise = app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    })

    const closeWindow = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: {
        uploadWindows: [
          {
            start: new Date(now - 120_000).toISOString(),
            end: new Date(now - 60_000).toISOString(),
          },
        ],
      },
    })
    expect(closeWindow.statusCode).toBe(200)

    const uploadRes = await uploadPromise
    expect(uploadRes.statusCode).toBe(403)
    expect(uploadRes.json().type).toBe('upload-window-closed')

    const db = getClient()
    const photoCount = await db.photo.count({ where: { galleryId } })
    expect(photoCount).toBe(0)
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
