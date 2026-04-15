import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { decryptTotpSecret, verifyTotpCode } from '../../services/twoFactor.js'
import { createSessionToken, hashSessionToken } from '../../services/sessionToken.js'

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
  user: { id: string } | null,
  ip: string,
  now: number
): Promise<void> {
  const db = fastify.db
  await fastify.recordIpFailure(ip)

  if (!user) return

  await db.$transaction(async (tx) => {
    const updated = await tx.adminUser.update({
      where: { id: user.id },
      data: {
        failedAttempts: { increment: 1 },
      },
      select: {
        failedAttempts: true,
        lockedUntil: true,
      },
    })

    if (updated.failedAttempts >= LOCK_THRESHOLD && !updated.lockedUntil) {
      await tx.adminUser.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(now + LOCK_DURATION_MS) },
      })
    }
  })
}

export async function adminAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const cleanupExpiredSessions = async () => {
    try {
      const db = fastify.db
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
    const db = fastify.db
    const now = Date.now()
    const ip = req.ip

    if (await fastify.checkIpBlocked(ip)) {
      reply.header('Retry-After', String(Math.ceil(LOCK_DURATION_MS / 1000)))
      return reply.code(429).send({
        type: 'ip-blocked',
        title: 'Too many failed attempts. Please try again in 15 minutes.',
        status: 429,
      })
    }

    const user = await db.adminUser.findUnique({ where: { username } })
    // Always hash-compare to prevent timing attacks / user enumeration
    const dummyHash = '$2a$12$aaaaaaaaaaaaaaaaaaaaaaOaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const hashToCheck = user?.passwordHash ?? dummyHash

    const valid = await bcrypt.compare(password, hashToCheck)

    if (user?.lockedUntil && user.lockedUntil.getTime() > now) {
      const remainingMinutes = Math.ceil((user.lockedUntil.getTime() - now) / MS_PER_MINUTE)
      const remainingSeconds = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now) / 1000))
      reply.header('Retry-After', String(remainingSeconds))
      return reply.code(429).send({
        type: 'account-locked',
        title: `Account locked. Please try again in ${remainingMinutes} minutes.`,
        status: 429,
      })
    }

    if (!user || !valid) {
      await recordFailedLoginAttempt(
        fastify,
        user ? { id: user.id } : null,
        ip,
        now
      )
      return reply.code(401).send({
        type: 'invalid-credentials',
        title: 'Invalid credentials.',
        status: 401,
      })
    }

    const hasTotpConfigured = Boolean(user.totpSecretEncrypted)
    if (hasTotpConfigured && !fastify.config.totpEnabled) {
      return reply.code(503).send({
        type: 'totp-misconfigured',
        title: '2FA is configured but disabled on the server.',
        status: 503,
      })
    }

    const requiresTotp = hasTotpConfigured
    if (requiresTotp) {
      if (!totpCode) {
        return reply.code(401).send({
          type: 'totp-required',
          title: '2FA code required.',
          status: 401,
        })
      }

      if (!fastify.config.totpEncryptionKey) {
        return reply.code(500).send({
          type: 'server-error',
          title: '2FA is not configured correctly.',
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
          title: '2FA is not configured correctly.',
          status: 500,
        })
      }

      if (!verifyTotpCode(totpSecret, totpCode)) {
        await recordFailedLoginAttempt(
          fastify,
          { id: user.id },
          ip,
          now
        )
        return reply.code(401).send({
          type: 'invalid-totp',
          title: 'Invalid 2FA code.',
          status: 401,
        })
      }
    }

    await db.adminUser.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    })
    await fastify.resetIpFailures(ip)

    const token = createSessionToken()
    const tokenHash = hashSessionToken(token)
    await db.session.create({
      data: {
        adminUserId: user.id,
        token: tokenHash,
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

  fastify.post('/admin/sessions/revoke-all', {
    preHandler: [fastify.requireAdmin],
  }, async (req, reply) => {
    if (!req.adminUserId) {
      return reply.code(401).send({ type: 'unauthorized', status: 401 })
    }

    const db = fastify.db
    await db.session.deleteMany({
      where: { adminUserId: req.adminUserId },
    })

    reply.clearCookie('session', { path: '/' })
    return reply.send({ ok: true })
  })

  fastify.post('/admin/logout', async (req, reply) => {
    const token = req.cookies['session']
    if (token) {
      const db = fastify.db
      const tokenHash = hashSessionToken(token)
      await db.session.deleteMany({
        where: {
          OR: [
            { token: tokenHash },
            { token },
          ],
        },
      }).catch(() => {})
    }
    reply.clearCookie('session', { path: '/' })
    return reply.send({ ok: true })
  })
}
