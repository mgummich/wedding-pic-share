import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { Redis } from 'ioredis'
import {
  buildTotpOtpAuthUrl,
  createTotpSetupToken,
  encryptTotpSecret,
  generateTotpSecret,
  readTotpSetupToken,
  verifyTotpCode,
} from '../../services/twoFactor.js'

const VERIFY_WINDOW_MS = 10 * 60 * 1000
const VERIFY_MAX_ATTEMPTS = 5
const TWO_FACTOR_KEY_PREFIX = 'wps:2fa'
const MEMORY_CLEANUP_INTERVAL_MS = 60_000

type TwoFactorStore = {
  isNonceUsed: (nonce: string, now: number) => Promise<boolean>
  markNonceUsed: (nonce: string, exp: number, now: number) => Promise<boolean>
  isVerifyRateLimited: (userId: string, ip: string, now: number) => Promise<boolean>
  recordVerifyFailure: (userId: string, ip: string, now: number) => Promise<void>
  resetVerifyFailures: (userId: string, ip: string) => Promise<void>
  close: () => Promise<void>
}

function createMemoryTwoFactorStore(): TwoFactorStore {
  const usedSetupNonces = new Map<string, number>()
  const verifyAttempts = new Map<string, { count: number; resetAt: number }>()

  const cleanup = (now: number): void => {
    for (const [nonce, exp] of usedSetupNonces.entries()) {
      if (exp <= now) usedSetupNonces.delete(nonce)
    }
    for (const [key, value] of verifyAttempts.entries()) {
      if (value.resetAt <= now) verifyAttempts.delete(key)
    }
  }

  const cleanupTimer = setInterval(() => {
    cleanup(Date.now())
  }, MEMORY_CLEANUP_INTERVAL_MS)
  cleanupTimer.unref()

  return {
    async isNonceUsed(nonce, now) {
      cleanup(now)
      return usedSetupNonces.has(nonce)
    },

    async markNonceUsed(nonce, exp, now) {
      cleanup(now)
      if (usedSetupNonces.has(nonce)) return false
      usedSetupNonces.set(nonce, exp)
      return true
    },

    async isVerifyRateLimited(userId, ip, now) {
      cleanup(now)
      const key = `${userId}:${ip}`
      const entry = verifyAttempts.get(key)
      return Boolean(entry && entry.count >= VERIFY_MAX_ATTEMPTS)
    },

    async recordVerifyFailure(userId, ip, now) {
      cleanup(now)
      const key = `${userId}:${ip}`
      const current = verifyAttempts.get(key)
      if (!current) {
        verifyAttempts.set(key, { count: 1, resetAt: now + VERIFY_WINDOW_MS })
        return
      }
      verifyAttempts.set(key, { count: current.count + 1, resetAt: current.resetAt })
    },

    async resetVerifyFailures(userId, ip) {
      verifyAttempts.delete(`${userId}:${ip}`)
    },

    async close() {
      clearInterval(cleanupTimer)
      usedSetupNonces.clear()
      verifyAttempts.clear()
    },
  }
}

function createRedisTwoFactorStore(redisUrl: string): TwoFactorStore {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })

  const nonceKey = (nonce: string) => `${TWO_FACTOR_KEY_PREFIX}:nonce:${nonce}`
  const verifyKey = (userId: string, ip: string) => `${TWO_FACTOR_KEY_PREFIX}:verify:${userId}:${ip}`

  return {
    async isNonceUsed(nonce) {
      return (await redis.exists(nonceKey(nonce))) === 1
    },

    async markNonceUsed(nonce, exp, now) {
      const ttlMs = Math.max(1_000, exp - now)
      const result = await redis.set(nonceKey(nonce), '1', 'PX', ttlMs, 'NX')
      return result === 'OK'
    },

    async isVerifyRateLimited(userId, ip) {
      const raw = await redis.get(verifyKey(userId, ip))
      const count = Number(raw)
      return Number.isFinite(count) && count >= VERIFY_MAX_ATTEMPTS
    },

    async recordVerifyFailure(userId, ip) {
      const key = verifyKey(userId, ip)
      const count = await redis.incr(key)
      if (count === 1) {
        await redis.pexpire(key, VERIFY_WINDOW_MS)
      }
    },

    async resetVerifyFailures(userId, ip) {
      await redis.del(verifyKey(userId, ip))
    },

    async close() {
      await redis.quit().catch(() => {})
    },
  }
}

export async function adminTwoFactorRoutes(fastify: FastifyInstance): Promise<void> {
  const store = fastify.config.redisUrl
    ? createRedisTwoFactorStore(fastify.config.redisUrl)
    : createMemoryTwoFactorStore()
  fastify.addHook('onClose', async () => {
    await store.close()
  })

  fastify.get('/admin/2fa/status', {
    preHandler: [fastify.requireAdmin],
  }, async (req, reply) => {
    const db = fastify.db
    const admin = await db.adminUser.findUnique({
      where: { id: req.adminUserId },
      select: { totpSecretEncrypted: true },
    })

    return reply.send({
      enabled: fastify.config.totpEnabled,
      configured: Boolean(admin?.totpSecretEncrypted),
    })
  })

  fastify.post('/admin/2fa/setup', {
    preHandler: [fastify.requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
  }, async (req, reply) => {
    if (!fastify.config.totpEnabled || !fastify.config.totpEncryptionKey) {
      return reply.code(409).send({
        type: 'totp-disabled',
        title: '2FA is disabled.',
        status: 409,
      })
    }

    const { password } = req.body as { password: string }
    const db = fastify.db
    const admin = await db.adminUser.findUnique({
      where: { id: req.adminUserId },
      select: { id: true, username: true, passwordHash: true },
    })
    if (!admin) {
      return reply.code(401).send({
        type: 'unauthorized',
        title: 'Unauthorized',
        status: 401,
      })
    }

    const validPassword = await bcrypt.compare(password, admin.passwordHash)
    if (!validPassword) {
      return reply.code(401).send({
        type: 'invalid-credentials',
        title: 'Invalid credentials.',
        status: 401,
      })
    }

    const secret = generateTotpSecret()
    const setupToken = createTotpSetupToken(
      { secret, userId: admin.id },
      fastify.config.totpEncryptionKey
    )
    const otpauthUrl = buildTotpOtpAuthUrl(secret, admin.username)

    return reply.send({
      secret,
      setupToken,
      otpauthUrl,
    })
  })

  fastify.post('/admin/2fa/verify', {
    preHandler: [fastify.requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['code', 'setupToken'],
        properties: {
          code: { type: 'string', minLength: 6, maxLength: 16 },
          setupToken: { type: 'string', minLength: 20, maxLength: 4096 },
        },
      },
    },
  }, async (req, reply) => {
    if (!fastify.config.totpEnabled || !fastify.config.totpEncryptionKey) {
      return reply.code(409).send({
        type: 'totp-disabled',
        title: '2FA is disabled.',
        status: 409,
      })
    }

    const { code, setupToken } = req.body as { code: string; setupToken: string }
    const now = Date.now()
    const userId = req.adminUserId as string
    if (await store.isVerifyRateLimited(userId, req.ip, now)) {
      return reply.code(429).send({
        type: 'totp-verify-rate-limited',
        title: 'Too many invalid 2FA attempts. Please wait and try again.',
        status: 429,
      })
    }

    let tokenPayload: ReturnType<typeof readTotpSetupToken>
    try {
      tokenPayload = readTotpSetupToken(setupToken, fastify.config.totpEncryptionKey)
    } catch {
      return reply.code(400).send({
        type: 'invalid-setup-token',
        title: 'Invalid or expired setup token.',
        status: 400,
      })
    }

    if (tokenPayload.userId !== req.adminUserId) {
      return reply.code(400).send({
        type: 'invalid-setup-token',
        title: 'Invalid or expired setup token.',
        status: 400,
      })
    }

    if (await store.isNonceUsed(tokenPayload.nonce, now)) {
      return reply.code(400).send({
        type: 'setup-token-used',
        title: 'This setup token has already been used.',
        status: 400,
      })
    }

    if (!verifyTotpCode(tokenPayload.secret, code)) {
      await store.recordVerifyFailure(userId, req.ip, now)
      return reply.code(401).send({
        type: 'invalid-totp',
        title: 'Invalid 2FA code.',
        status: 401,
      })
    }

    const db = fastify.db
    await db.adminUser.update({
      where: { id: req.adminUserId },
      data: {
        totpSecretEncrypted: encryptTotpSecret(tokenPayload.secret, fastify.config.totpEncryptionKey),
      },
    })
    const nonceMarked = await store.markNonceUsed(tokenPayload.nonce, tokenPayload.exp, now)
    if (!nonceMarked) {
      return reply.code(400).send({
        type: 'setup-token-used',
        title: 'This setup token has already been used.',
        status: 400,
      })
    }
    await store.resetVerifyFailures(userId, req.ip)

    return reply.send({ ok: true })
  })
}
