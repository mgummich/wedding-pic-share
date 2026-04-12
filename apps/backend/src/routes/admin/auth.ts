import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { getClient } from '@wedding/db'

const LOCK_THRESHOLD = 5
const LOCK_DURATION_MS = 15 * 60 * 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const MS_PER_MINUTE = 60 * 1000

export async function adminAuthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/admin/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 64 },
          password: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
  }, async (req, reply) => {
    const { username, password } = req.body as { username: string; password: string }
    const db = getClient()
    const now = Date.now()
    const ip = req.ip

    if (fastify.checkIpBlocked(ip)) {
      return reply.code(429).send({
        type: 'ip-blocked',
        title: 'Zu viele Fehlversuche. Bitte versuche es in 15 Minuten erneut.',
        status: 429,
      })
    }

    const user = await db.adminUser.findUnique({ where: { username } })
    // Always hash-compare to prevent timing attacks / user enumeration
    const dummyHash = '$2a$12$aaaaaaaaaaaaaaaaaaaaaaOaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const hashToCheck = user?.passwordHash ?? dummyHash

    if (user?.lockedUntil && user.lockedUntil.getTime() > now) {
      const remainingMinutes = Math.ceil((user.lockedUntil.getTime() - now) / MS_PER_MINUTE)
      return reply.code(429).send({
        type: 'account-locked',
        title: `Konto gesperrt. Bitte versuche es in ${remainingMinutes} Minuten erneut.`,
        status: 429,
      })
    }

    const valid = await bcrypt.compare(password, hashToCheck)

    if (!user || !valid) {
      fastify.recordIpFailure(ip)

      if (user) {
        const newAttempts = user.failedAttempts + 1
        const lockedUntil = newAttempts >= LOCK_THRESHOLD
          ? new Date(now + LOCK_DURATION_MS)
          : null
        await db.adminUser.update({
          where: { id: user.id },
          data: { failedAttempts: newAttempts, lockedUntil },
        })
      }
      return reply.code(401).send({
        type: 'invalid-credentials',
        title: 'Ungültige Anmeldedaten.',
        status: 401,
      })
    }

    await db.adminUser.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    })
    fastify.resetIpFailures(ip)

    const token = randomBytes(32).toString('hex')
    await db.session.create({
      data: {
        adminUserId: user.id,
        token,
        expiresAt: new Date(now + SESSION_TTL_MS),
      },
    })

    reply.setCookie('session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: fastify.config.cookieSecure,
      maxAge: SESSION_TTL_MS / 1000,
      path: '/',
    })

    return reply.send({ ok: true })
  })

  fastify.post('/admin/logout', async (req, reply) => {
    const token = req.cookies['session']
    if (token) {
      const db = getClient()
      await db.session.deleteMany({ where: { token } }).catch(() => {})
    }
    reply.clearCookie('session', { path: '/' })
    return reply.send({ ok: true })
  })
}
