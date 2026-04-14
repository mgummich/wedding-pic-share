import type { FastifyInstance } from 'fastify'

export async function adminCsrfRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/admin/csrf', {
    preHandler: [fastify.requireAdmin],
  }, async (_req, reply) => {
    const csrfToken = await reply.generateCsrf()
    return reply.send({ csrfToken })
  })
}
