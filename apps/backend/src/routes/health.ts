import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_req, reply) => {
    let dbStatus: 'ok' | 'error' = 'ok'
    try {
      const db = getClient()
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
    return reply.send({ ready: true })
  })
}
