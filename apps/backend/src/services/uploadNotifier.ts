import nodemailer from 'nodemailer'
import type { FastifyBaseLogger } from 'fastify'
import { createHmac } from 'crypto'
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
  fetchImpl?: typeof fetch
}

async function postWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function isSmtpConfigured(config: AppConfig): boolean {
  return Boolean(config.smtpHost && config.smtpFrom && config.adminEmail)
}

function isWebhookConfigured(config: AppConfig): boolean {
  return Boolean(config.webhookUrl)
}

function isNtfyConfigured(config: AppConfig): boolean {
  return Boolean(config.ntfyTopic)
}

export function createUploadNotifier(
  config: AppConfig,
  logger: Pick<FastifyBaseLogger, 'error' | 'info'>,
  deps: UploadNotifierDeps = {}
): UploadNotifier {
  const createTransport = deps.createTransport ?? ((options: {
    host: string
    port: number
    secure: boolean
    auth?: { user: string; pass: string }
  }) => nodemailer.createTransport(options))
  const fetchImpl = deps.fetchImpl ?? fetch

  const smtpEnabled = isSmtpConfigured(config)
  const webhookEnabled = isWebhookConfigured(config)
  const ntfyEnabled = isNtfyConfigured(config)

  if (!smtpEnabled) {
    logger.info('SMTP notifications disabled: missing SMTP_HOST, SMTP_FROM, or ADMIN_EMAIL')
  }
  if (!webhookEnabled) {
    logger.info('Webhook notifications disabled: WEBHOOK_URL not configured')
  }
  if (!ntfyEnabled) {
    logger.info('NTFY notifications disabled: NTFY_TOPIC not configured')
  }

  const transport = smtpEnabled
    ? createTransport({
      host: config.smtpHost!,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: config.smtpUser && config.smtpPass
        ? { user: config.smtpUser, pass: config.smtpPass }
        : undefined,
    })
    : null

  return {
    async notifyGuestUpload(payload: UploadNotificationPayload) {
      if (smtpEnabled && transport) {
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
      }

      if (webhookEnabled) {
        try {
          const body = JSON.stringify({
            event: 'guest-upload',
            gallerySlug: payload.gallerySlug,
            photoId: payload.photoId,
            mediaType: payload.mediaType,
            status: payload.status,
            timestamp: new Date().toISOString(),
          })
          const headers: Record<string, string> = {
            'content-type': 'application/json',
            'x-wps-event': 'guest-upload',
          }
          if (config.webhookSecret) {
            const signature = createHmac('sha256', config.webhookSecret)
              .update(body)
              .digest('hex')
            headers['x-wps-signature'] = `sha256=${signature}`
          }

          const response = await postWithTimeout(fetchImpl, config.webhookUrl!, {
            method: 'POST',
            headers,
            body,
          }, config.notificationTimeoutMs)
          if (!response.ok) {
            throw new Error(`webhook returned status ${response.status}`)
          }
        } catch (error) {
          logger.error({ error, gallerySlug: payload.gallerySlug, photoId: payload.photoId }, 'webhook.notification.failed')
        }
      }

      if (ntfyEnabled) {
        try {
          const message = [
            'New upload',
            `Gallery: ${payload.gallerySlug}`,
            `Photo ID: ${payload.photoId}`,
            `Type: ${payload.mediaType}`,
            `Status: ${payload.status}`,
          ].join('\n')
          const ntfyUrl = `https://ntfy.sh/${encodeURIComponent(config.ntfyTopic!)}`
          const response = await postWithTimeout(fetchImpl, ntfyUrl, {
            method: 'POST',
            headers: {
              'content-type': 'text/plain; charset=utf-8',
              title: 'Wedding Pic Share Upload',
              tags: 'camera',
            },
            body: message,
          }, config.notificationTimeoutMs)
          if (!response.ok) {
            throw new Error(`ntfy returned status ${response.status}`)
          }
        } catch (error) {
          logger.error({ error, gallerySlug: payload.gallerySlug, photoId: payload.photoId }, 'ntfy.notification.failed')
        }
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
