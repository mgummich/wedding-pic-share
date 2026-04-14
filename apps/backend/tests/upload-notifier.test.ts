import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createUploadNotifier } from '../src/services/uploadNotifier.js'
import type { AppConfig } from '../src/config.js'

const baseConfig: AppConfig = {
  port: 4000,
  databaseUrl: 'file:/tmp/test.db',
  frontendUrl: 'http://localhost:3000',
  sessionSecret: 'test-secret-32-chars-xxxxxxxxxxxx',
  cookieSecure: false,
  adminUsername: 'admin',
  adminPassword: 'Password123!',
  storageProvider: 'local',
  storageLocalPath: '/tmp/uploads',
  s3Endpoint: null,
  s3Bucket: null,
  s3Region: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  maxFileSizeMb: 50,
  maxVideoSizeMb: 200,
  slideshowIntervalSeconds: 8,
  smtpHost: null,
  smtpPort: 587,
  smtpUser: null,
  smtpPass: null,
  smtpFrom: null,
  adminEmail: null,
}

describe('createUploadNotifier', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  }

  beforeEach(() => {
    logger.info.mockReset()
    logger.error.mockReset()
  })

  it('is a no-op when SMTP is not configured', async () => {
    const sendMail = vi.fn()
    const createTransport = vi.fn(() => ({ sendMail }))
    const notifier = createUploadNotifier(baseConfig, logger, { createTransport })

    await expect(notifier.notifyGuestUpload({
      galleryName: 'Uploads',
      gallerySlug: 'uploads',
      photoId: 'photo_1',
      mediaType: 'IMAGE',
      status: 'PENDING',
    })).resolves.toBeUndefined()

    expect(createTransport).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('sends an email when SMTP is configured', async () => {
    const sendMail = vi.fn().mockResolvedValue({})
    const createTransport = vi.fn(() => ({ sendMail }))
    const notifier = createUploadNotifier({
      ...baseConfig,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpFrom: 'Wedding App <noreply@example.com>',
      adminEmail: 'admin@example.com',
    }, logger, { createTransport })

    await notifier.notifyGuestUpload({
      galleryName: 'Uploads',
      gallerySlug: 'uploads',
      photoId: 'photo_2',
      mediaType: 'IMAGE',
      status: 'PENDING',
    })

    expect(createTransport).toHaveBeenCalledTimes(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      from: 'Wedding App <noreply@example.com>',
      to: 'admin@example.com',
    })
  })

  it('does not throw when SMTP sending fails', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('smtp down'))
    const createTransport = vi.fn(() => ({ sendMail }))
    const notifier = createUploadNotifier({
      ...baseConfig,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpFrom: 'Wedding App <noreply@example.com>',
      adminEmail: 'admin@example.com',
    }, logger, { createTransport })

    await expect(notifier.notifyGuestUpload({
      galleryName: 'Uploads',
      gallerySlug: 'uploads',
      photoId: 'photo_3',
      mediaType: 'VIDEO',
      status: 'APPROVED',
    })).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
