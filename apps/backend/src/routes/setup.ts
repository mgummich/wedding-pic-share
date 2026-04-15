import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { timingSafeEqual } from 'node:crypto'

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

const BOOTSTRAP_ADMIN_ID = 'bootstrap-admin'

function readSetupTokenHeader(rawValue: string | string[] | undefined): string | null {
  if (typeof rawValue === 'string') {
    const normalized = rawValue.trim()
    return normalized.length > 0 ? normalized : null
  }
  if (Array.isArray(rawValue) && rawValue.length > 0) {
    const first = rawValue[0]?.trim()
    return first && first.length > 0 ? first : null
  }
  return null
}

function safeEqual(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value)
  const expectedBuffer = Buffer.from(expected)
  if (valueBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(valueBuffer, expectedBuffer)
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return (error as { code?: unknown }).code === 'P2002'
}

export async function setupRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/setup/status', async (_req, reply) => {
    const db = fastify.db
    const adminCount = await db.adminUser.count()

    return reply.send({ setupRequired: adminCount === 0 })
  })

  fastify.post('/setup', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 64 },
          password: { type: 'string', minLength: 12, maxLength: 128 },
          weddingName: { type: 'string', minLength: 1, maxLength: 100 },
          galleryName: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      username: string
      password: string
      weddingName?: string
      galleryName?: string
    }
    const providedSetupToken = readSetupTokenHeader(req.headers['x-setup-token'])
    const configuredSetupToken = fastify.config.setupToken
    if (!configuredSetupToken) {
      return reply.code(503).send({
        type: 'setup-token-not-configured',
        title: 'Setup token is not configured on the server.',
        status: 503,
      })
    }
    if (!providedSetupToken || !safeEqual(providedSetupToken, configuredSetupToken)) {
      return reply.code(401).send({
        type: 'invalid-setup-token',
        title: 'Invalid setup token.',
        status: 401,
      })
    }

    const db = fastify.db

    const passwordHash = await bcrypt.hash(body.password, 12)

    try {
      await db.$transaction(async (tx) => {
        const existingAdmin = await tx.adminUser.count()
        if (existingAdmin > 0) {
          throw new Error('setup-complete')
        }

        await tx.adminUser.create({
          data: {
            id: BOOTSTRAP_ADMIN_ID,
            username: body.username,
            passwordHash,
            failedAttempts: 0,
          },
        })

        if (!body.weddingName) {
          return
        }

        const wedding = await tx.wedding.create({
          data: {
            name: body.weddingName,
            slug: toSlug(body.weddingName),
          },
        })

        const galleryName = body.galleryName ?? body.weddingName
        await tx.gallery.create({
          data: {
            weddingId: wedding.id,
            name: galleryName,
            slug: toSlug(galleryName),
          },
        })
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'setup-complete') {
        return reply.code(409).send({
          type: 'setup-complete',
          title: 'Setup already completed.',
          status: 409,
        })
      }
      if (isPrismaUniqueConstraintError(error)) {
        return reply.code(409).send({
          type: 'setup-complete',
          title: 'Setup already completed.',
          status: 409,
        })
      }
      throw error
    }

    return reply.code(201).send({ ok: true })
  })
}
