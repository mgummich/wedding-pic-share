import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { seedAdmin } from '../src/seed.js'
import { closeClient } from '@wedding/db'
import type { UploadNotifier } from '../src/services/uploadNotifier.js'

let app: FastifyInstance
const DB_PATH = `/tmp/wps-webhooks-test-${process.pid}.db`
const notifyGuestUpload = vi.fn<UploadNotifier['notifyGuestUpload']>().mockResolvedValue(undefined)

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${DB_PATH}`
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'testadmin'
  process.env.ADMIN_PASSWORD = 'TestPassword123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-test-webhooks'
  process.env.NODE_ENV = 'test'

  const { execSync } = await import('child_process')
  execSync('npx prisma migrate deploy', {
    cwd: join(process.cwd(), '../../packages/db'),
    env: { ...process.env },
    stdio: 'pipe',
  })

  const config = loadConfig()
  app = await buildApp(config, {
    uploadNotifier: { notifyGuestUpload },
  })
  await app.ready()
  await seedAdmin(config)
})

afterAll(async () => {
  if (app) {
    await app.close()
  }
  await closeClient()
  await unlink(DB_PATH).catch(() => {})
  await unlink(`${DB_PATH}-wal`).catch(() => {})
  await unlink(`${DB_PATH}-shm`).catch(() => {})
})

describe('POST /api/v1/admin/webhooks/test', () => {
  it('requires admin auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/webhooks/test',
    })
    expect(res.statusCode).toBe(401)
  })

  it('triggers a notifier test event for logged-in admins', async () => {
    notifyGuestUpload.mockClear()

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    const cookie = login.headers['set-cookie'] as string

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/webhooks/test',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ ok: true })
    expect(notifyGuestUpload).toHaveBeenCalledTimes(1)
    expect(notifyGuestUpload).toHaveBeenCalledWith(expect.objectContaining({
      gallerySlug: 'test-event',
      photoId: 'test-event',
      status: 'PENDING',
    }))
  })
})
