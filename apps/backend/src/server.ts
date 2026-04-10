import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import csrf from '@fastify/csrf-protection'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { healthRoutes } from './routes/health.js'
import { authPlugin } from './plugins/auth.js'
import { adminAuthRoutes } from './routes/admin/auth.js'
import { adminGalleryRoutes } from './routes/admin/galleries.js'
import { guestGalleryRoutes } from './routes/guest/gallery.js'
import { guestUploadRoutes } from './routes/guest/upload.js'
import { guestSlideshowRoutes } from './routes/guest/slideshow.js'
import { guestQrRoutes } from './routes/guest/qr.js'
import { guestDownloadRoutes } from './routes/guest/download.js'
import { adminPhotoRoutes } from './routes/admin/photos.js'
import { adminExportRoutes } from './routes/admin/export.js'
import { fileRoutes } from './routes/files.js'
import { createStorage } from './services/storage.js'
import { createSseManager } from './services/sse.js'
import type { AppConfig } from './config.js'

export async function buildApp(config?: AppConfig) {
  const fastify = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  })

  const maxVideoSize = (config?.maxVideoSizeMb ?? 200) * 1024 * 1024
  const sessionSecret = config?.sessionSecret ?? 'dev-secret-minimum-32-chars-xxx'

  await fastify.register(helmet)

  await fastify.register(cors, {
    origin: config?.frontendUrl ?? process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  })

  await fastify.register(cookie, {
    secret: sessionSecret,
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

  const storage = createStorage({
    provider: config?.storageProvider ?? 'local',
    localPath: config?.storageLocalPath ?? './data/uploads',
  })
  const sse = createSseManager()

  fastify.decorate('storage', storage)
  fastify.decorate('sse', sse)

  await fastify.register(healthRoutes)

  await fastify.register(authPlugin)

  await fastify.register(async (instance) => {
    await instance.register(adminAuthRoutes)
    await instance.register(adminGalleryRoutes)
    await instance.register(guestGalleryRoutes)
    await instance.register(guestUploadRoutes, { storage, sse })
    await instance.register(guestSlideshowRoutes, { sse })
    await instance.register(guestQrRoutes)
    await instance.register(guestDownloadRoutes, { storage })
    await instance.register(adminPhotoRoutes, { sse })
    await instance.register(adminExportRoutes, { storage })
    await instance.register(fileRoutes, { storage })
  }, { prefix: '/api/v1' })

  return fastify
}
