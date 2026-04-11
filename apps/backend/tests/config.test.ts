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
    delete process.env.COOKIE_SECURE
    expect(loadConfig().cookieSecure).toBe(true)
  })

  it('COOKIE_SECURE=false overrides production NODE_ENV', () => {
    process.env.NODE_ENV = 'production'
    process.env.COOKIE_SECURE = 'false'
    expect(loadConfig().cookieSecure).toBe(false)
  })
})
