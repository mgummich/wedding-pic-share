import type { FastifyInstance } from 'fastify'
import { Redis } from 'ioredis'

const READINESS_TIMEOUT_MS = 1_000

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_req, reply) => {
    let dbStatus: 'ok' | 'error' = 'ok'
    try {
      const db = fastify.db
      await db.$queryRaw`SELECT 1`
    } catch {
      dbStatus = 'error'
    }

    const status = dbStatus === 'ok' ? 'ok' : 'degraded'
    const statusCode = status === 'ok' ? 200 : 503

    return reply.code(statusCode).send({
      status,
      db: dbStatus,
      uptime: Math.floor(process.uptime()),
    })
  })

  fastify.get('/ready', async (_req, reply) => {
    let dbReady = true
    try {
      await fastify.db.$queryRaw`SELECT 1`
    } catch {
      dbReady = false
    }

    let redisReady = true
    if (fastify.config.redisUrl) {
      const redis = new Redis(fastify.config.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      })

      try {
        await Promise.race([
          redis.ping(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('redis-readiness-timeout')), READINESS_TIMEOUT_MS)
          }),
        ])
      } catch {
        redisReady = false
      } finally {
        await redis.quit().catch(() => {})
      }
    }

    const ready = dbReady && redisReady
    return reply.code(ready ? 200 : 503).send({
      ready,
      dependencies: {
        db: dbReady ? 'ok' : 'error',
        redis: fastify.config.redisUrl ? (redisReady ? 'ok' : 'error') : 'not-configured',
      },
    })
  })
}
