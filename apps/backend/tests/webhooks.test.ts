import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { seedAdmin } from '../src/seed.js'
import { closeClient } from '@wedding/db'
import type { UploadNotifier } from '../src/services/uploadNotifier.js'
import { createBackendTestEnv, type BackendTestEnv } from './helpers/backendTestEnv.js'

let app: FastifyInstance
const notifyGuestUpload = vi.fn<UploadNotifier['notifyGuestUpload']>().mockResolvedValue(undefined)
let testEnv: BackendTestEnv

beforeAll(async () => {
  testEnv = await createBackendTestEnv('webhooks', {
    adminUsername: 'testadmin',
    adminPassword: 'TestPassword123!',
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
  await testEnv.cleanup()
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
