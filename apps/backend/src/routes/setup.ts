import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { getClient } from '@wedding/db'

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export async function setupRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/setup/status', async (_req, reply) => {
    const db = getClient()
    const adminCount = await db.adminUser.count()

    return reply.send({ setupRequired: adminCount === 0 })
  })

  fastify.post('/setup', {
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
    const db = getClient()

    const existingAdmin = await db.adminUser.count()
    if (existingAdmin > 0) {
      return reply.code(409).send({
        type: 'setup-complete',
        title: 'Setup bereits abgeschlossen.',
        status: 409,
      })
    }

    const passwordHash = await bcrypt.hash(body.password, 12)

    await db.$transaction(async (tx) => {
      await tx.adminUser.create({
        data: {
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

    return reply.code(201).send({ message: 'Setup abgeschlossen.' })
  })
}
