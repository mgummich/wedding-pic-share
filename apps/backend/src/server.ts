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

  await fastify.register(healthRoutes)

  await fastify.register(authPlugin)

  await fastify.register(async (instance) => {
    await instance.register(adminAuthRoutes)
  }, { prefix: '/api/v1' })

  return fastify
}
