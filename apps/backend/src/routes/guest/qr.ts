import type { FastifyInstance } from 'fastify'
import QRCode from 'qrcode'
import { getClient } from '@wedding/db'

export async function guestQrRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/g/:slug/qr', {
    schema: {
      params: { type: 'object', properties: { slug: { type: 'string', pattern: '^[a-z0-9-]+$' } } },
      querystring: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['png', 'svg'], default: 'png' },
        },
      },
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const { format = 'png' } = req.query as { format?: 'png' | 'svg' }

    const db = getClient()
    const gallery = await db.gallery.findFirst({ where: { slug } })
    if (!gallery) return reply.code(404).send({ type: 'gallery-not-found', status: 404 })

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'
    const url = `${frontendUrl}/g/${slug}/upload`

    const qrOptions = {
      errorCorrectionLevel: 'H' as const, // high: 30% — survives print damage
      margin: 4,
      color: { dark: '#2C2C2C', light: '#FAF7F4' },
    }

    if (format === 'svg') {
      const svg = await QRCode.toString(url, { ...qrOptions, type: 'svg' })
      reply.header('Content-Type', 'image/svg+xml')
      reply.header('Content-Disposition', `attachment; filename="${slug}-qr.svg"`)
      return reply.send(svg)
    } else {
      const png = await QRCode.toBuffer(url, { ...qrOptions, scale: 10 })
      reply.header('Content-Type', 'image/png')
      reply.header('Content-Disposition', `attachment; filename="${slug}-qr.png"`)
      return reply.send(png)
    }
  })
}
