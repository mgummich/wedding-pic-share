import fp from 'fastify-plugin'
import type { PrismaClient } from '@wedding/db'
import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify'
import type { AppConfig } from '../config.js'
import { hashSessionToken } from '../services/sessionToken.js'

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig
    db: PrismaClient
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

    const db = fastify.db
    const tokenHash = hashSessionToken(token)
    // Primary lookup uses hashed token storage (default since security hardening).
    let session = await db.session.findUnique({
      where: { token: tokenHash },
      include: { admin: true },
    })

    // Backward compatibility: migrate legacy plaintext session rows on first use.
    if (!session) {
      const legacySession = await db.session.findUnique({
        where: { token },
        include: { admin: true },
      })
      if (legacySession) {
        await db.session.update({
          where: { id: legacySession.id },
          data: { token: tokenHash },
        }).catch(() => {})
        session = {
          ...legacySession,
          token: tokenHash,
        }
      }
    }

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await db.session.delete({ where: { id: session.id } }).catch(() => {})
      }
      return reply.code(401).send({
        type: 'unauthorized',
        title: 'Session expired',
        status: 401,
      })
    }

    req.adminUserId = session.adminUserId
  })
})
