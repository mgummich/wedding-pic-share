import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import csrf from '@fastify/csrf-protection'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { healthRoutes } from './routes/health.js'
import { authPlugin } from './plugins/auth.js'
import { bruteForcePlugin } from './plugins/bruteForce.js'
import { adminAuthRoutes } from './routes/admin/auth.js'
import { setupRoutes } from './routes/setup.js'
import { adminGalleryRoutes } from './routes/admin/galleries.js'
import { guestGalleryRoutes } from './routes/guest/gallery.js'
import { guestUploadRoutes } from './routes/guest/upload.js'
import { guestSlideshowRoutes } from './routes/guest/slideshow.js'
import { guestQrRoutes } from './routes/guest/qr.js'
import { guestDownloadRoutes } from './routes/guest/download.js'
import { adminPhotoRoutes } from './routes/admin/photos.js'
import { adminExportRoutes } from './routes/admin/export.js'
import { adminArchiveRoutes } from './routes/admin/archive.js'
import { adminTwoFactorRoutes } from './routes/admin/twoFactor.js'
import { adminWebhookRoutes } from './routes/admin/webhooks.js'
import { adminCsrfRoutes } from './routes/admin/csrf.js'
import { fileRoutes } from './routes/files.js'
import { createStorage } from './services/storage.js'
import { createSseManager } from './services/sse.js'
import type { StorageService } from './services/storage.js'
import type { SseManager } from './services/sse.js'
import { createUploadNotifier, type UploadNotifier } from './services/uploadNotifier.js'
import { loadConfig, type AppConfig } from './config.js'
import { createMediaProcessor, type MediaProcessor } from './services/mediaProcessor.js'

type BuildAppDeps = {
  storage?: StorageService
  sse?: SseManager
  uploadNotifier?: UploadNotifier
  mediaProcessor?: MediaProcessor
}

export async function buildApp(config?: AppConfig, deps: BuildAppDeps = {}) {
  const resolvedConfig = config ?? loadConfig()
  const fastify = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    trustProxy: resolvedConfig.trustProxy,
  })

  const maxVideoSize = resolvedConfig.maxVideoSizeMb * 1024 * 1024

  await fastify.register(helmet)

  await fastify.register(cors, {
    origin: resolvedConfig.frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  })

  await fastify.register(cookie, {
    secret: resolvedConfig.sessionSecret,
  })

  await fastify.register(csrf, {
    sessionPlugin: '@fastify/cookie',
    cookieOpts: { signed: true, httpOnly: true, sameSite: 'strict' },
  })

  await fastify.register(rateLimit, {
    global: false,
  })

  await fastify.register(multipart, {
    limits: {
      fileSize: maxVideoSize,
      files: 10,
      fields: 5,
      headerPairs: 100,
    },
  })

  const storage = deps.storage ?? createStorage({
    provider: resolvedConfig.storageProvider,
    localPath: resolvedConfig.storageLocalPath,
  })
  const sse = deps.sse ?? createSseManager()
  const uploadNotifier = deps.uploadNotifier ?? createUploadNotifier(resolvedConfig, fastify.log)
  const mediaProcessor = deps.mediaProcessor ?? createMediaProcessor({
    mode: resolvedConfig.mediaProcessingMode,
    concurrency: resolvedConfig.mediaProcessingConcurrency,
    jobTimeoutMs: resolvedConfig.mediaProcessingJobTimeoutMs,
    redisUrl: resolvedConfig.redisUrl,
  })

  fastify.decorate('config', resolvedConfig)
  fastify.decorate('storage', storage)
  fastify.decorate('sse', sse)

  await fastify.register(healthRoutes)

  await fastify.register(authPlugin)
  await fastify.register(bruteForcePlugin)

  await fastify.register(async (instance) => {
    instance.addHook('preHandler', (req, reply, done) => {
      const method = req.method.toUpperCase()
      const isMutatingMethod = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)
      if (!isMutatingMethod) {
        done()
        return
      }

      const pathname = req.raw.url?.split('?')[0] ?? ''
      const isAdminPath = pathname.startsWith('/api/v1/admin/')
      const isCsrfExempt = pathname === '/api/v1/admin/login' || pathname === '/api/v1/admin/csrf'
      const hasOriginHeader = typeof req.headers.origin === 'string'
      if (!isAdminPath || isCsrfExempt || !hasOriginHeader) {
        done()
        return
      }

      instance.csrfProtection(req, reply, done)
    })

    await instance.register(setupRoutes)
    await instance.register(adminAuthRoutes)
    await instance.register(adminCsrfRoutes)
    await instance.register(adminGalleryRoutes)
    await instance.register(guestGalleryRoutes)
    await instance.register(guestUploadRoutes, { storage, sse, uploadNotifier, mediaProcessor })
    await instance.register(guestSlideshowRoutes, { sse })
    await instance.register(guestQrRoutes)
    await instance.register(guestDownloadRoutes, { storage })
    await instance.register(adminPhotoRoutes, { sse, storage, mediaProcessor })
    await instance.register(adminArchiveRoutes, { sse, storage })
    await instance.register(adminExportRoutes, { storage })
    await instance.register(adminTwoFactorRoutes)
    await instance.register(adminWebhookRoutes, { uploadNotifier })
    await instance.register(fileRoutes, { storage })
  }, { prefix: '/api/v1' })

  fastify.addHook('onClose', async () => {
    await mediaProcessor.close()
  })

  return fastify
}
