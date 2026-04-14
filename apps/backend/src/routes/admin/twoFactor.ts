import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
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
const usedSetupNonces = new Map<string, number>()
const verifyAttempts = new Map<string, { count: number; resetAt: number }>()

function cleanupMaps(now: number): void {
  for (const [nonce, exp] of usedSetupNonces.entries()) {
    if (exp <= now) usedSetupNonces.delete(nonce)
  }
  for (const [key, value] of verifyAttempts.entries()) {
    if (value.resetAt <= now) verifyAttempts.delete(key)
  }
}

function getVerifyAttemptKey(userId: string, ip: string): string {
  return `${userId}:${ip}`
}

function checkVerifyRateLimit(key: string, now: number): boolean {
  const entry = verifyAttempts.get(key)
  if (!entry) return false
  if (entry.resetAt <= now) {
    verifyAttempts.delete(key)
    return false
  }
  return entry.count >= VERIFY_MAX_ATTEMPTS
}

function recordVerifyFailure(key: string, now: number): void {
  const current = verifyAttempts.get(key)
  if (!current || current.resetAt <= now) {
    verifyAttempts.set(key, { count: 1, resetAt: now + VERIFY_WINDOW_MS })
    return
  }
  verifyAttempts.set(key, { count: current.count + 1, resetAt: current.resetAt })
}

function resetVerifyFailures(key: string): void {
  verifyAttempts.delete(key)
}

export async function adminTwoFactorRoutes(fastify: FastifyInstance): Promise<void> {
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
        title: '2FA ist deaktiviert.',
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
        title: 'Ungültige Anmeldedaten.',
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
        title: '2FA ist deaktiviert.',
        status: 409,
      })
    }

    const { code, setupToken } = req.body as { code: string; setupToken: string }
    const now = Date.now()
    cleanupMaps(now)

    const verifyAttemptKey = getVerifyAttemptKey(req.adminUserId as string, req.ip)
    if (checkVerifyRateLimit(verifyAttemptKey, now)) {
      return reply.code(429).send({
        type: 'totp-verify-rate-limited',
        title: 'Zu viele 2FA-Fehlversuche. Bitte warte kurz und versuche es erneut.',
        status: 429,
      })
    }

    let tokenPayload: ReturnType<typeof readTotpSetupToken>
    try {
      tokenPayload = readTotpSetupToken(setupToken, fastify.config.totpEncryptionKey)
    } catch {
      return reply.code(400).send({
        type: 'invalid-setup-token',
        title: 'Ungültiger oder abgelaufener Setup-Token.',
        status: 400,
      })
    }

    if (tokenPayload.userId !== req.adminUserId) {
      return reply.code(400).send({
        type: 'invalid-setup-token',
        title: 'Ungültiger oder abgelaufener Setup-Token.',
        status: 400,
      })
    }

    if (usedSetupNonces.has(tokenPayload.nonce)) {
      return reply.code(400).send({
        type: 'setup-token-used',
        title: 'Dieser Setup-Token wurde bereits verwendet.',
        status: 400,
      })
    }

    if (!verifyTotpCode(tokenPayload.secret, code)) {
      recordVerifyFailure(verifyAttemptKey, now)
      return reply.code(401).send({
        type: 'invalid-totp',
        title: 'Ungültiger 2FA-Code.',
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
    usedSetupNonces.set(tokenPayload.nonce, tokenPayload.exp)
    resetVerifyFailures(verifyAttemptKey)

    return reply.send({ ok: true })
  })
}
