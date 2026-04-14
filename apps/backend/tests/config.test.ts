import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
    process.env.ADMIN_PASSWORD = 'password12345'
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns defaults for optional fields', () => {
    const config = loadConfig()
    expect(config.port).toBe(4000)
    expect(config.maxFileSizeMb).toBe(50)
    expect(config.maxVideoSizeMb).toBe(200)
    expect(config.storageProvider).toBe('local')
    expect(config.slideshowIntervalSeconds).toBe(8)
    expect(config.trustProxy).toBe('loopback, linklocal, uniquelocal')
    expect(config.seedAdminOnBoot).toBe(true)
  })

  it('throws when SESSION_SECRET is missing', () => {
    delete process.env.SESSION_SECRET
    expect(() => loadConfig()).toThrow('SESSION_SECRET is required')
  })

  it('throws when ADMIN_PASSWORD is missing', () => {
    delete process.env.ADMIN_PASSWORD
    expect(() => loadConfig()).toThrow('ADMIN_PASSWORD is required')
  })

  it('reads custom values from env', () => {
    process.env.PORT = '5000'
    process.env.STORAGE_PROVIDER = 'local'
    process.env.MAX_FILE_SIZE_MB = '100'
    const config = loadConfig()
    expect(config.port).toBe(5000)
    expect(config.maxFileSizeMb).toBe(100)
  })

  it('cookieSecure defaults to false when NODE_ENV is not production', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.COOKIE_SECURE
    expect(loadConfig().cookieSecure).toBe(false)
  })

  it('cookieSecure defaults to true when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_SQLITE_IN_PRODUCTION = 'true'
    delete process.env.COOKIE_SECURE
    expect(loadConfig().cookieSecure).toBe(true)
  })

  it('COOKIE_SECURE=false overrides production NODE_ENV', () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_SQLITE_IN_PRODUCTION = 'true'
    process.env.COOKIE_SECURE = 'false'
    expect(loadConfig().cookieSecure).toBe(false)
  })

  it('throws for non-https WEBHOOK_URL', () => {
    process.env.WEBHOOK_URL = 'http://hooks.example.com/wps'
    expect(() => loadConfig()).toThrow('WEBHOOK_URL must start with https://')
  })

  it('accepts https WEBHOOK_URL', () => {
    process.env.WEBHOOK_URL = 'https://hooks.example.com/wps'
    expect(loadConfig().webhookUrl).toBe('https://hooks.example.com/wps')
  })

  it('throws when STORAGE_PROVIDER=s3 because s3 backend is not implemented yet', () => {
    process.env.STORAGE_PROVIDER = 's3'
    expect(() => loadConfig()).toThrow('STORAGE_PROVIDER=s3 is not implemented yet')
  })

  it('throws for SQLite in production unless explicitly acknowledged', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'file:/tmp/prod.db'
    delete process.env.ALLOW_SQLITE_IN_PRODUCTION
    expect(() => loadConfig()).toThrow('SQLite is not recommended for production multi-instance deployments')
  })

  it('allows SQLite in production when ALLOW_SQLITE_IN_PRODUCTION=true', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'file:/tmp/prod.db'
    process.env.ALLOW_SQLITE_IN_PRODUCTION = 'true'
    expect(loadConfig().databaseUrl).toBe('file:/tmp/prod.db')
  })

  it('supports TRUST_PROXY override', () => {
    process.env.TRUST_PROXY = '10.0.0.0/8,192.168.0.0/16'
    expect(loadConfig().trustProxy).toBe('10.0.0.0/8,192.168.0.0/16')
  })

  it('disables admin seeding by default in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_SQLITE_IN_PRODUCTION = 'true'
    expect(loadConfig().seedAdminOnBoot).toBe(false)
  })

  it('supports SEED_ADMIN_ON_BOOT override', () => {
    process.env.SEED_ADMIN_ON_BOOT = 'false'
    expect(loadConfig().seedAdminOnBoot).toBe(false)

    process.env.SEED_ADMIN_ON_BOOT = 'true'
    expect(loadConfig().seedAdminOnBoot).toBe(true)
  })
})
