export interface AppConfig {
  port: number
  databaseUrl: string
  frontendUrl: string
  sessionSecret: string
  cookieSecure: boolean
  adminUsername: string
  adminPassword: string
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

  return {
    port: Number(process.env.PORT ?? 4000),
    databaseUrl: process.env.DATABASE_URL ?? 'file:./data/db.sqlite',
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    sessionSecret,
    cookieSecure: process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === 'true'
      : process.env.NODE_ENV === 'production',
    adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
    adminPassword,
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
  }
}
