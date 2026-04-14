import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { getClient } from '@wedding/db'
import { decryptTotpSecret, verifyTotpCode } from '../../services/twoFactor.js'

const LOCK_THRESHOLD = 5
const LOCK_DURATION_MS = 15 * 60 * 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const MS_PER_MINUTE = 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 15 * 60 * 1000

type LoginBody = {
  username: string
  password: string
  totpCode?: string
}

async function recordFailedLoginAttempt(
  fastify: FastifyInstance,
  user: { id: string; failedAttempts: number } | null,
  ip: string,
  now: number
): Promise<void> {
  const db = getClient()
  fastify.recordIpFailure(ip)

  if (!user) return

  const newAttempts = user.failedAttempts + 1
  const lockedUntil = newAttempts >= LOCK_THRESHOLD
    ? new Date(now + LOCK_DURATION_MS)
    : null
  await db.adminUser.update({
    where: { id: user.id },
    data: { failedAttempts: newAttempts, lockedUntil },
  })
}

export async function adminAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const cleanupExpiredSessions = async () => {
    try {
      const db = getClient()
      await db.session.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      })
    } catch (error) {
      fastify.log.warn({ err: error }, 'failed to cleanup expired sessions')
    }
  }

  const cleanupTimer = setInterval(() => {
    void cleanupExpiredSessions()
  }, SESSION_CLEANUP_INTERVAL_MS)
  cleanupTimer.unref()
  fastify.addHook('onClose', async () => {
    clearInterval(cleanupTimer)
  })

  void cleanupExpiredSessions()

  fastify.post('/admin/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 64 },
          password: { type: 'string', minLength: 1, maxLength: 128 },
          totpCode: { type: 'string', minLength: 6, maxLength: 16 },
        },
      },
    },
  }, async (req, reply) => {
    const { username, password, totpCode } = req.body as LoginBody
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
      await recordFailedLoginAttempt(
        fastify,
        user ? { id: user.id, failedAttempts: user.failedAttempts } : null,
        ip,
        now
      )
      return reply.code(401).send({
        type: 'invalid-credentials',
        title: 'Ungültige Anmeldedaten.',
        status: 401,
      })
    }

    const hasTotpConfigured = Boolean(user.totpSecretEncrypted)
    if (hasTotpConfigured && !fastify.config.totpEnabled) {
      return reply.code(503).send({
        type: 'totp-misconfigured',
        title: '2FA ist konfiguriert, aber serverseitig deaktiviert.',
        status: 503,
      })
    }

    const requiresTotp = hasTotpConfigured
    if (requiresTotp) {
      if (!totpCode) {
        return reply.code(401).send({
          type: 'totp-required',
          title: '2FA-Code erforderlich.',
          status: 401,
        })
      }

      if (!fastify.config.totpEncryptionKey) {
        return reply.code(500).send({
          type: 'server-error',
          title: '2FA ist nicht korrekt konfiguriert.',
          status: 500,
        })
      }

      let totpSecret: string
      try {
        totpSecret = decryptTotpSecret(user.totpSecretEncrypted as string, fastify.config.totpEncryptionKey)
      } catch (error) {
        fastify.log.error({ err: error }, 'failed to decrypt totp secret')
        return reply.code(500).send({
          type: 'server-error',
          title: '2FA ist nicht korrekt konfiguriert.',
          status: 500,
        })
      }

      if (!verifyTotpCode(totpSecret, totpCode)) {
        await recordFailedLoginAttempt(
          fastify,
          { id: user.id, failedAttempts: user.failedAttempts },
          ip,
          now
        )
        return reply.code(401).send({
          type: 'invalid-totp',
          title: 'Ungültiger 2FA-Code.',
          status: 401,
        })
      }
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

  fastify.get('/admin/session', {
    preHandler: [fastify.requireAdmin],
  }, async (_req, reply) => {
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
