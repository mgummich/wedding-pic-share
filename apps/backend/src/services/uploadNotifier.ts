import nodemailer from 'nodemailer'
import type { FastifyBaseLogger } from 'fastify'
import type { AppConfig } from '../config.js'

export type UploadNotificationPayload = {
  galleryName: string
  gallerySlug: string
  photoId: string
  mediaType: 'IMAGE' | 'VIDEO'
  status: 'PENDING' | 'APPROVED'
}

export type UploadNotifier = {
  notifyGuestUpload: (payload: UploadNotificationPayload) => Promise<void>
}

type MailTransport = {
  sendMail: (message: {
    from: string
    to: string
    subject: string
    text: string
    html: string
  }) => Promise<unknown>
}

type UploadNotifierDeps = {
  createTransport?: (options: {
    host: string
    port: number
    secure: boolean
    auth?: { user: string; pass: string }
  }) => MailTransport
}

function isSmtpConfigured(config: AppConfig): boolean {
  return Boolean(config.smtpHost && config.smtpFrom && config.adminEmail)
}

export function createUploadNotifier(
  config: AppConfig,
  logger: Pick<FastifyBaseLogger, 'error' | 'info'>,
  deps: UploadNotifierDeps = {}
): UploadNotifier {
  if (!isSmtpConfigured(config)) {
    logger.info('SMTP notifications disabled: missing SMTP_HOST, SMTP_FROM, or ADMIN_EMAIL')
    return {
      async notifyGuestUpload() {
        return
      },
    }
  }

  const createTransport = deps.createTransport ?? ((options: {
    host: string
    port: number
    secure: boolean
    auth?: { user: string; pass: string }
  }) => nodemailer.createTransport(options))
  const transport = createTransport({
    host: config.smtpHost!,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: config.smtpUser && config.smtpPass
      ? { user: config.smtpUser, pass: config.smtpPass }
      : undefined,
  })

  return {
    async notifyGuestUpload(payload: UploadNotificationPayload) {
      const subject = `[Wedding Pic Share] Neuer Upload in ${payload.galleryName}`
      const adminUrl = `${config.frontendUrl.replace(/\/$/, '')}/admin`
      const text = [
        'Ein neuer Upload wurde eingereicht.',
        '',
        `Galerie: ${payload.galleryName} (${payload.gallerySlug})`,
        `Foto-ID: ${payload.photoId}`,
        `Typ: ${payload.mediaType}`,
        `Status: ${payload.status}`,
        '',
        `Admin-Bereich: ${adminUrl}`,
      ].join('\n')
      const html = [
        '<p>Ein neuer Upload wurde eingereicht.</p>',
        '<ul>',
        `<li><strong>Galerie:</strong> ${escapeHtml(payload.galleryName)} (${escapeHtml(payload.gallerySlug)})</li>`,
        `<li><strong>Foto-ID:</strong> ${escapeHtml(payload.photoId)}</li>`,
        `<li><strong>Typ:</strong> ${escapeHtml(payload.mediaType)}</li>`,
        `<li><strong>Status:</strong> ${escapeHtml(payload.status)}</li>`,
        '</ul>',
        `<p><a href="${escapeHtml(adminUrl)}">Zum Admin-Bereich</a></p>`,
      ].join('')

      try {
        await transport.sendMail({
          from: config.smtpFrom!,
          to: config.adminEmail!,
          subject,
          text,
          html,
        })
      } catch (error) {
        logger.error({ error, gallerySlug: payload.gallerySlug, photoId: payload.photoId }, 'smtp.notification.failed')
      }
    },
  }
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
