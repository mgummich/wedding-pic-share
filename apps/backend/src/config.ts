export interface AppConfig {
  port: number
  databaseUrl: string
  trustProxy: boolean | string
  frontendUrl: string
  sessionSecret: string
  cookieSecure: boolean
  adminUsername: string
  adminPassword: string
  seedAdminOnBoot: boolean
  storageProvider: 'local' | 's3'
  storageLocalPath: string
  s3Endpoint: string | null
  s3Bucket: string | null
  s3Region: string | null
  s3AccessKeyId: string | null
  s3SecretAccessKey: string | null
  maxFileSizeMb: number
  maxVideoSizeMb: number
  slideshowIntervalSeconds: number
  smtpHost: string | null
  smtpPort: number
  smtpUser: string | null
  smtpPass: string | null
  smtpFrom: string | null
  adminEmail: string | null
  webhookUrl: string | null
  webhookSecret: string | null
  ntfyTopic: string | null
  notificationTimeoutMs: number
  mediaProcessingMode: 'inline' | 'worker-thread' | 'bullmq'
  mediaProcessingConcurrency: number
  mediaProcessingJobTimeoutMs: number
  redisUrl: string | null
  totpEnabled: boolean
  totpEncryptionKey: string | null
}

export function loadConfig(): AppConfig {
  const sessionSecret = process.env.SESSION_SECRET
  if (!sessionSecret) throw new Error('SESSION_SECRET is required')

  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) throw new Error('ADMIN_PASSWORD is required')
  if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters')

  const storageProvider = process.env.STORAGE_PROVIDER ?? 'local'
  if (storageProvider !== 'local' && storageProvider !== 's3') {
    throw new Error(`Invalid STORAGE_PROVIDER: "${storageProvider}". Must be "local" or "s3"`)
  }
  if (storageProvider === 's3') {
    throw new Error('STORAGE_PROVIDER=s3 is not implemented yet. Use STORAGE_PROVIDER=local.')
  }

  const databaseUrl = process.env.DATABASE_URL ?? 'file:./data/db.sqlite'
  const isFileDatabase = databaseUrl.startsWith('file:')
  if (process.env.NODE_ENV === 'production' && isFileDatabase && process.env.ALLOW_SQLITE_IN_PRODUCTION !== 'true') {
    throw new Error(
      'SQLite is not recommended for production multi-instance deployments. ' +
      'Set DATABASE_URL to a network database or ALLOW_SQLITE_IN_PRODUCTION=true to acknowledge the risk.'
    )
  }

  const trustProxyEnv = process.env.TRUST_PROXY?.trim()
  const trustProxy = trustProxyEnv
    ? trustProxyEnv === 'true'
      ? true
      : trustProxyEnv === 'false'
        ? false
        : trustProxyEnv
    : 'loopback, linklocal, uniquelocal'

  const defaultMediaMode = process.env.NODE_ENV === 'test' ? 'inline' : 'worker-thread'
  const mediaProcessingMode = process.env.MEDIA_PROCESSING_MODE ?? defaultMediaMode
  if (!['inline', 'worker-thread', 'bullmq'].includes(mediaProcessingMode)) {
    throw new Error(
      `Invalid MEDIA_PROCESSING_MODE: "${mediaProcessingMode}". Must be "inline", "worker-thread", or "bullmq"`
    )
  }

  const mediaProcessingConcurrency = Number(process.env.MEDIA_PROCESSING_CONCURRENCY ?? 2)
  if (!Number.isInteger(mediaProcessingConcurrency) || mediaProcessingConcurrency < 1 || mediaProcessingConcurrency > 32) {
    throw new Error('MEDIA_PROCESSING_CONCURRENCY must be an integer between 1 and 32')
  }

  const mediaProcessingJobTimeoutMs = Number(process.env.MEDIA_PROCESSING_JOB_TIMEOUT_MS ?? 120000)
  if (!Number.isInteger(mediaProcessingJobTimeoutMs) || mediaProcessingJobTimeoutMs < 1000) {
    throw new Error('MEDIA_PROCESSING_JOB_TIMEOUT_MS must be an integer >= 1000')
  }

  const webhookUrl = process.env.WEBHOOK_URL?.trim() || null
  if (webhookUrl && !webhookUrl.startsWith('https://')) {
    throw new Error('WEBHOOK_URL must start with https://')
  }

  const webhookSecret = process.env.WEBHOOK_SECRET?.trim() || null
  const ntfyTopic = process.env.NTFY_TOPIC?.trim() || null
  const notificationTimeoutMs = Number(process.env.NOTIFICATION_TIMEOUT_MS ?? 5000)
  if (!Number.isInteger(notificationTimeoutMs) || notificationTimeoutMs < 500 || notificationTimeoutMs > 60000) {
    throw new Error('NOTIFICATION_TIMEOUT_MS must be an integer between 500 and 60000')
  }

  const totpEnabled = process.env.TOTP_ENABLED === 'true'
  const totpEncryptionKey = process.env.TOTP_ENCRYPTION_KEY ?? null
  if (totpEnabled) {
    if (!totpEncryptionKey) {
      throw new Error('TOTP_ENCRYPTION_KEY is required when TOTP_ENABLED=true')
    }
    if (!/^[0-9a-fA-F]{64}$/.test(totpEncryptionKey)) {
      throw new Error('TOTP_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
    }
  } else if (totpEncryptionKey && !/^[0-9a-fA-F]{64}$/.test(totpEncryptionKey)) {
    throw new Error('TOTP_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  }

  const seedAdminOnBoot = process.env.SEED_ADMIN_ON_BOOT === 'true'

  return {
    port: Number(process.env.PORT ?? 4000),
    databaseUrl,
    trustProxy,
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    sessionSecret,
    cookieSecure: process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === 'true'
      : process.env.NODE_ENV === 'production',
    adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
    adminPassword,
    seedAdminOnBoot,
    storageProvider: storageProvider as 'local' | 's3',
    storageLocalPath: process.env.STORAGE_LOCAL_PATH ?? './data/uploads',
    s3Endpoint: process.env.S3_ENDPOINT ?? null,
    s3Bucket: process.env.S3_BUCKET ?? null,
    s3Region: process.env.S3_REGION ?? null,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? null,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? null,
    maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB ?? 50),
    maxVideoSizeMb: Number(process.env.MAX_VIDEO_SIZE_MB ?? 200),
    slideshowIntervalSeconds: Number(process.env.SLIDESHOW_INTERVAL_SECONDS ?? 8),
    smtpHost: process.env.SMTP_HOST ?? null,
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    smtpUser: process.env.SMTP_USER ?? null,
    smtpPass: process.env.SMTP_PASS ?? null,
    smtpFrom: process.env.SMTP_FROM ?? null,
    adminEmail: process.env.ADMIN_EMAIL ?? null,
    webhookUrl,
    webhookSecret,
    ntfyTopic,
    notificationTimeoutMs,
    mediaProcessingMode: mediaProcessingMode as 'inline' | 'worker-thread' | 'bullmq',
    mediaProcessingConcurrency,
    mediaProcessingJobTimeoutMs,
    redisUrl: process.env.REDIS_URL ?? null,
    totpEnabled,
    totpEncryptionKey: totpEncryptionKey?.toLowerCase() ?? null,
  }
}
