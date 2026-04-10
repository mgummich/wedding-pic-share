import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { closeClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  process.env.DATABASE_URL = 'file::memory:?cache=shared'
  process.env.NODE_ENV = 'test'
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_PASSWORD = 'password123'
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await closeClient()
})

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
  })
})

describe('GET /ready', () => {
  it('returns 200 when ready', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ready).toBe(true)
  })
})
