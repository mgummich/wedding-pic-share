import fp from 'fastify-plugin'
import { getClient } from '@wedding/db'
import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify'
import type { AppConfig } from '../config.js'

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    adminUserId?: string
  }
}

export const authPlugin = fp(async (fastify: FastifyInstance) => {
  fastify.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies['session']
    if (!token) {
      return reply.code(401).send({
        type: 'unauthorized',
        title: 'Unauthorized',
        status: 401,
      })
    }

    const db = getClient()
    const session = await db.session.findUnique({
      where: { token },
      include: { admin: true },
    })

    if (!session || session.expiresAt < new Date()) {
      return reply.code(401).send({
        type: 'unauthorized',
        title: 'Session expired',
        status: 401,
      })
    }

    req.adminUserId = session.adminUserId
  })
})
