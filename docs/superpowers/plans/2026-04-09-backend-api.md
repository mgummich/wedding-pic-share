# Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete Fastify REST API — admin auth, gallery CRUD, file upload with Sharp/ffmpeg processing, moderation, SSE slideshow stream, media serving, QR generation, and ZIP export.

**Architecture:** All API routes under `/api/v1` (except `/health` and `/ready`). Admin routes require session cookie + CSRF token. Guest routes are public. Upload pipeline: multipart → MIME validation → SHA-256 dedup → Sharp (images) or ffmpeg (videos) → local/S3 storage → DB. SSE uses an in-memory `Map<galleryId, Set<SSEConnection>>`.

**Tech Stack:** Fastify 5, @fastify/multipart, @fastify/cookie, @fastify/csrf-protection, @fastify/helmet, @fastify/cors, @fastify/rate-limit, Sharp, fluent-ffmpeg, file-type, bcrypt, qrcode, archiver, Pino, Vitest

**Prerequisite:** Foundation plan must be complete (`@wedding/db` and `@wedding/shared` built).

---

## File Map

| File | Responsibility |
|---|---|
| `apps/backend/src/server.ts` | Plugin registration, route mounting |
| `apps/backend/src/config.ts` | Env-based config with validation |
| `apps/backend/src/plugins/auth.ts` | Session auth decorator (`requireAdmin`) |
| `apps/backend/src/plugins/csrf.ts` | CSRF plugin registration |
| `apps/backend/src/plugins/ratelimit.ts` | Rate limit presets |
| `apps/backend/src/routes/health.ts` | GET /health, GET /ready |
| `apps/backend/src/routes/admin/auth.ts` | POST /admin/login, POST /admin/logout |
| `apps/backend/src/routes/admin/galleries.ts` | Gallery CRUD |
| `apps/backend/src/routes/admin/photos.ts` | Moderation + batch |
| `apps/backend/src/routes/admin/export.ts` | ZIP export |
| `apps/backend/src/routes/guest/gallery.ts` | GET /g/:slug (paginated) |
| `apps/backend/src/routes/guest/upload.ts` | POST /g/:slug/upload |
| `apps/backend/src/routes/guest/slideshow.ts` | GET /g/:slug/slideshow/stream (SSE) |
| `apps/backend/src/routes/guest/qr.ts` | GET /g/:slug/qr |
| `apps/backend/src/routes/guest/download.ts` | GET /g/:slug/download (ZIP) |
| `apps/backend/src/routes/files.ts` | GET /files/:slug/:filename (media serving) |
| `apps/backend/src/services/media.ts` | Sharp + ffmpeg processing |
| `apps/backend/src/services/storage.ts` | Storage abstraction (local/S3) |
| `apps/backend/src/services/sse.ts` | In-memory SSE connection map |
| `apps/backend/src/seed.ts` | Create initial AdminUser on first start |
| `apps/backend/tests/auth.test.ts` | Admin login/logout tests |
| `apps/backend/tests/gallery.test.ts` | Gallery CRUD tests |
| `apps/backend/tests/upload.test.ts` | Upload pipeline tests |
| `apps/backend/tests/moderation.test.ts` | Approve/reject/batch tests |
| `apps/backend/tests/sse.test.ts` | SSE service unit tests |
| `apps/backend/tests/media.test.ts` | Sharp/ffmpeg service tests |

---

### Task 1: Config and Plugin Registration

**Files:**
- Create: `apps/backend/src/config.ts`
- Modify: `apps/backend/src/server.ts`

- [ ] **Step 1: Write failing config test**

Create `apps/backend/tests/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('returns defaults for optional fields', () => {
    process.env.DATABASE_URL = 'file::memory:'
    process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxx'
    process.env.ADMIN_USERNAME = 'admin'
    process.env.ADMIN_PASSWORD = 'password123'
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
    process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxx'
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/backend && pnpm test tests/config.test.ts
```

Expected: FAIL with "Cannot find module '../src/config.js'"

- [ ] **Step 3: Create `apps/backend/src/config.ts`**

```typescript
export interface AppConfig {
  port: number
  databaseUrl: string
  frontendUrl: string
  sessionSecret: string
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

  return {
    port: Number(process.env.PORT ?? 4000),
    databaseUrl: process.env.DATABASE_URL ?? 'file:./data/db.sqlite',
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    sessionSecret,
    adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
    adminPassword,
    storageProvider: (process.env.STORAGE_PROVIDER ?? 'local') as 'local' | 's3',
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/config.test.ts
```

Expected: PASS

- [ ] **Step 5: Update `apps/backend/package.json` — add all plugin dependencies**

```json
{
  "dependencies": {
    "@fastify/cookie": "^9.0.0",
    "@fastify/cors": "^9.0.0",
    "@fastify/csrf-protection": "^7.0.0",
    "@fastify/helmet": "^11.0.0",
    "@fastify/multipart": "^8.0.0",
    "@fastify/rate-limit": "^9.0.0",
    "@wedding/db": "workspace:*",
    "@wedding/shared": "workspace:*",
    "archiver": "^7.0.0",
    "bcryptjs": "^2.4.3",
    "file-type": "^19.0.0",
    "fluent-ffmpeg": "^2.1.3",
    "fastify": "^5.0.0",
    "qrcode": "^1.5.4",
    "sharp": "^0.33.0"
  },
  "devDependencies": {
    "@types/archiver": "^6.0.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/fluent-ffmpeg": "^2.1.24",
    "@types/node": "^20.0.0",
    "@types/qrcode": "^1.5.5",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 6: Install dependencies**

```bash
pnpm install
```

- [ ] **Step 7: Replace `apps/backend/src/server.ts` with full plugin setup**

```typescript
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import csrf from '@fastify/csrf-protection'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { healthRoutes } from './routes/health.js'
import type { AppConfig } from './config.js'

export async function buildApp(config: AppConfig) {
  const fastify = Fastify({
    logger: process.env.NODE_ENV !== 'test'
      ? { level: 'info' }
      : false,
  })

  await fastify.register(helmet, {
    contentSecurityPolicy: false, // configured separately per route
  })

  await fastify.register(cors, {
    origin: config.frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  })

  await fastify.register(cookie, {
    secret: config.sessionSecret,
  })

  await fastify.register(csrf, {
    sessionPlugin: '@fastify/cookie',
    cookieOpts: { signed: true, httpOnly: true, sameSite: 'strict' },
  })

  await fastify.register(rateLimit, {
    global: false, // apply per-route
  })

  await fastify.register(multipart, {
    limits: {
      fileSize: config.maxVideoSizeMb * 1024 * 1024,
      files: 10,
      fields: 5,
      headerPairs: 100,
    },
  })

  await fastify.register(healthRoutes)

  return fastify
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/config.ts apps/backend/src/server.ts apps/backend/package.json apps/backend/tests/config.test.ts
git commit -m "feat(backend): config module and full plugin registration"
```

---

### Task 2: Storage Service

**Files:**
- Create: `apps/backend/src/services/storage.ts`
- Create: `apps/backend/tests/storage.test.ts`

- [ ] **Step 1: Write failing storage test**

Create `apps/backend/tests/storage.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createStorage } from '../src/services/storage.js'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'

const TMP_DIR = join(process.cwd(), 'tmp-storage-test')

beforeAll(() => mkdir(TMP_DIR, { recursive: true }))
afterAll(() => rm(TMP_DIR, { recursive: true, force: true }))

describe('local storage', () => {
  const storage = createStorage({ provider: 'local', localPath: TMP_DIR })

  it('saves and retrieves a file', async () => {
    const content = Buffer.from('hello world')
    await storage.save('test-gallery', 'test.txt', content)
    const retrieved = await storage.get('test-gallery', 'test.txt')
    expect(retrieved.toString()).toBe('hello world')
  })

  it('returns a public URL', () => {
    const url = storage.publicUrl('test-gallery', 'test.txt')
    expect(url).toContain('test-gallery')
    expect(url).toContain('test.txt')
  })

  it('deletes a file', async () => {
    await storage.save('test-gallery', 'to-delete.txt', Buffer.from('bye'))
    await storage.delete('test-gallery', 'to-delete.txt')
    await expect(storage.get('test-gallery', 'to-delete.txt')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/storage.test.ts
```

Expected: FAIL with "Cannot find module '../src/services/storage.js'"

- [ ] **Step 3: Create `apps/backend/src/services/storage.ts`**

```typescript
import { mkdir, readFile, writeFile, unlink } from 'fs/promises'
import { join, dirname } from 'path'

export interface StorageService {
  save(gallerySlug: string, filename: string, data: Buffer): Promise<void>
  get(gallerySlug: string, filename: string): Promise<Buffer>
  delete(gallerySlug: string, filename: string): Promise<void>
  publicUrl(gallerySlug: string, filename: string): string
  filePath(gallerySlug: string, filename: string): string
}

interface StorageConfig {
  provider: 'local' | 's3'
  localPath: string
}

export function createStorage(config: StorageConfig): StorageService {
  if (config.provider === 's3') {
    throw new Error('S3 storage not yet implemented — set STORAGE_PROVIDER=local')
  }
  return createLocalStorage(config.localPath)
}

function createLocalStorage(basePath: string): StorageService {
  function filePath(gallerySlug: string, filename: string): string {
    return join(basePath, gallerySlug, filename)
  }

  return {
    filePath,

    async save(gallerySlug, filename, data) {
      const fp = filePath(gallerySlug, filename)
      await mkdir(dirname(fp), { recursive: true })
      await writeFile(fp, data)
    },

    async get(gallerySlug, filename) {
      return readFile(filePath(gallerySlug, filename))
    },

    async delete(gallerySlug, filename) {
      await unlink(filePath(gallerySlug, filename))
    },

    publicUrl(gallerySlug, filename) {
      return `/api/v1/files/${gallerySlug}/${filename}`
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/storage.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/storage.ts apps/backend/tests/storage.test.ts
git commit -m "feat(backend): local storage service"
```

---

### Task 3: Media Processing Service

**Files:**
- Create: `apps/backend/src/services/media.ts`
- Create: `apps/backend/tests/media.test.ts`

- [ ] **Step 1: Write failing media test**

Create `apps/backend/tests/media.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { processImage, generateBlurDataUrl } from '../src/services/media.js'
import { readFile } from 'fs/promises'
import { join } from 'path'

describe('processImage', () => {
  it('creates thumb and display variants from a JPEG', async () => {
    // Create a minimal 10x10 JPEG buffer using sharp
    const sharp = (await import('sharp')).default
    const inputBuf = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: '#ff0000' },
    }).jpeg().toBuffer()

    const result = await processImage(inputBuf, 'image/jpeg')

    expect(result.thumb).toBeInstanceOf(Buffer)
    expect(result.display).toBeInstanceOf(Buffer)
    expect(result.original).toBeInstanceOf(Buffer)
    expect(result.blurDataUrl).toMatch(/^data:image\/webp;base64,/)

    // Verify thumb is resized to 400px width
    const thumbMeta = await sharp(result.thumb).metadata()
    expect(thumbMeta.width).toBe(400)

    // Verify display is max 1920px width
    const displayMeta = await sharp(result.display).metadata()
    expect(displayMeta.width).toBeLessThanOrEqual(1920)

    // Verify EXIF is stripped (no GPS)
    expect(thumbMeta.exif).toBeUndefined()
  })

  it('generates a base64 blur placeholder', async () => {
    const sharp = (await import('sharp')).default
    const buf = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#blue' },
    }).webp().toBuffer()

    const blur = await generateBlurDataUrl(buf)
    expect(blur).toMatch(/^data:image\/webp;base64,/)
    const decoded = Buffer.from(blur.split(',')[1], 'base64')
    expect(decoded.length).toBeLessThan(500) // tiny placeholder
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/media.test.ts
```

Expected: FAIL with "Cannot find module '../src/services/media.js'"

- [ ] **Step 3: Create `apps/backend/src/services/media.ts`**

```typescript
import sharp from 'sharp'
import { createHash } from 'crypto'
import { promisify } from 'util'
import { exec } from 'child_process'
import { writeFile, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const execAsync = promisify(exec)

export interface ImageProcessingResult {
  thumb: Buffer      // 400px WEBP, EXIF stripped
  display: Buffer    // max 1920px WEBP, EXIF stripped
  original: Buffer   // original bytes (EXIF stripped)
  blurDataUrl: string
}

export interface VideoProcessingResult {
  poster: Buffer     // 400px WEBP poster frame at 1s
  blurDataUrl: string
  durationSeconds: number
}

export async function processImage(
  inputBuffer: Buffer,
  _mimeType: string
): Promise<ImageProcessingResult> {
  const base = sharp(inputBuffer).withMetadata({ icc: true }) // keep ICC, strip GPS

  const thumb = await base
    .clone()
    .resize(400, undefined, { withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer()

  const display = await base
    .clone()
    .resize(1920, undefined, { withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer()

  const original = await base.clone().webp({ quality: 95 }).toBuffer()

  const blurDataUrl = await generateBlurDataUrl(thumb)

  return { thumb, display, original, blurDataUrl }
}

export async function generateBlurDataUrl(thumbBuffer: Buffer): Promise<string> {
  const tiny = await sharp(thumbBuffer)
    .resize(10, undefined, { withoutEnlargement: true })
    .webp({ quality: 20 })
    .toBuffer()
  return `data:image/webp;base64,${tiny.toString('base64')}`
}

export async function processVideo(inputBuffer: Buffer): Promise<VideoProcessingResult> {
  // Write input to temp file
  const tmpIn = join(tmpdir(), `wps-video-${Date.now()}.mp4`)
  const tmpPoster = join(tmpdir(), `wps-poster-${Date.now()}.jpg`)

  try {
    await writeFile(tmpIn, inputBuffer)

    // Extract poster frame at 1s
    await execAsync(
      `ffmpeg -y -ss 1 -i "${tmpIn}" -vframes 1 -q:v 2 "${tmpPoster}"`
    )

    const posterJpeg = await readFile(tmpPoster)
    const poster = await sharp(posterJpeg)
      .resize(400, undefined, { withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer()

    const blurDataUrl = await generateBlurDataUrl(poster)

    // Get duration via ffprobe
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tmpIn}"`
    )
    const durationSeconds = Math.round(parseFloat(stdout.trim()))

    return { poster, blurDataUrl, durationSeconds }
  } finally {
    await unlink(tmpIn).catch(() => {})
    await unlink(tmpPoster).catch(() => {})
  }
}

export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/media.test.ts
```

Expected: PASS (2 tests). Note: requires `sharp` installed.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/media.ts apps/backend/tests/media.test.ts
git commit -m "feat(backend): image + video processing service (sharp + ffmpeg)"
```

---

### Task 4: SSE Service

**Files:**
- Create: `apps/backend/src/services/sse.ts`
- Create: `apps/backend/tests/sse.test.ts`

- [ ] **Step 1: Write failing SSE service test**

Create `apps/backend/tests/sse.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createSseManager } from '../src/services/sse.js'
import type { PhotoResponse } from '@wedding/shared'

describe('SseManager', () => {
  let manager: ReturnType<typeof createSseManager>

  beforeEach(() => {
    manager = createSseManager()
  })

  it('tracks connection count per gallery', () => {
    const send = () => {}
    manager.add('gallery-1', 'conn-1', send)
    manager.add('gallery-1', 'conn-2', send)
    manager.add('gallery-2', 'conn-3', send)

    expect(manager.connectionCount('gallery-1')).toBe(2)
    expect(manager.connectionCount('gallery-2')).toBe(1)
  })

  it('removes connections on disconnect', () => {
    const send = () => {}
    manager.add('gallery-1', 'conn-1', send)
    manager.remove('gallery-1', 'conn-1')
    expect(manager.connectionCount('gallery-1')).toBe(0)
  })

  it('broadcasts to all connections in a gallery', () => {
    const received: string[] = []
    const send1 = (data: string) => received.push(`c1:${data}`)
    const send2 = (data: string) => received.push(`c2:${data}`)

    manager.add('gallery-1', 'conn-1', send1)
    manager.add('gallery-1', 'conn-2', send2)

    const photo: PhotoResponse = {
      id: 'photo-1',
      mediaType: 'IMAGE',
      thumbUrl: '/thumb.webp',
      displayUrl: '/display.webp',
      duration: null,
      guestName: 'Max',
      createdAt: new Date().toISOString(),
    }
    manager.broadcast('gallery-1', 'new-photo', photo)

    expect(received).toHaveLength(2)
    expect(received[0]).toContain('c1:')
    expect(received[1]).toContain('c2:')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/sse.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `apps/backend/src/services/sse.ts`**

```typescript
export type SseSendFn = (data: string) => void

interface SseConnection {
  id: string
  send: SseSendFn
}

export interface SseManager {
  add(galleryId: string, connectionId: string, send: SseSendFn): void
  remove(galleryId: string, connectionId: string): void
  broadcast(galleryId: string, event: string, data: unknown): void
  sendHeartbeat(galleryId: string): void
  connectionCount(galleryId: string): number
}

export function createSseManager(): SseManager {
  const map = new Map<string, Map<string, SseConnection>>()

  function getOrCreate(galleryId: string): Map<string, SseConnection> {
    if (!map.has(galleryId)) map.set(galleryId, new Map())
    return map.get(galleryId)!
  }

  return {
    add(galleryId, connectionId, send) {
      getOrCreate(galleryId).set(connectionId, { id: connectionId, send })
    },

    remove(galleryId, connectionId) {
      const gallery = map.get(galleryId)
      if (!gallery) return
      gallery.delete(connectionId)
      if (gallery.size === 0) map.delete(galleryId)
    },

    broadcast(galleryId, event, data) {
      const gallery = map.get(galleryId)
      if (!gallery) return
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      for (const conn of gallery.values()) {
        try { conn.send(payload) } catch { /* dead connection */ }
      }
    },

    sendHeartbeat(galleryId) {
      const gallery = map.get(galleryId)
      if (!gallery) return
      const payload = `event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`
      for (const conn of gallery.values()) {
        try { conn.send(payload) } catch { /* dead connection */ }
      }
    },

    connectionCount(galleryId) {
      return map.get(galleryId)?.size ?? 0
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/sse.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/sse.ts apps/backend/tests/sse.test.ts
git commit -m "feat(backend): in-memory SSE manager"
```

---

### Task 5: Admin Auth Routes

**Files:**
- Create: `apps/backend/src/seed.ts`
- Create: `apps/backend/src/plugins/auth.ts`
- Create: `apps/backend/src/routes/admin/auth.ts`
- Create: `apps/backend/tests/auth.test.ts`

- [ ] **Step 1: Write failing auth test**

Create `apps/backend/tests/auth.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { getClient, closeClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  process.env.DATABASE_URL = 'file::memory:?cache=shared'
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'testadmin'
  process.env.ADMIN_PASSWORD = 'TestPassword123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-test-auth'

  const config = loadConfig()
  app = await buildApp(config)
  await app.ready()

  // Seed admin user
  const { seedAdmin } = await import('../src/seed.js')
  await seedAdmin(config)
})

afterAll(async () => {
  await app.close()
  await closeClient()
})

describe('POST /api/v1/admin/login', () => {
  it('returns 200 and sets session cookie on valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.cookies.some((c) => c.name === 'session')).toBe(true)
  })

  it('returns 401 on wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'WrongPassword' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 on unknown user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'nobody', password: 'anything' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/v1/admin/logout', () => {
  it('clears the session cookie', async () => {
    // Login first
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'testadmin', password: 'TestPassword123!' },
    })
    const cookie = login.headers['set-cookie'] as string

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/logout',
      headers: { cookie },
    })
    expect(logout.statusCode).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/auth.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `apps/backend/src/seed.ts`**

```typescript
import bcrypt from 'bcryptjs'
import { getClient } from '@wedding/db'
import type { AppConfig } from './config.js'

export async function seedAdmin(config: AppConfig): Promise<void> {
  const db = getClient()
  const existing = await db.adminUser.findUnique({
    where: { username: config.adminUsername },
  })
  if (existing) return

  const passwordHash = await bcrypt.hash(config.adminPassword, 12)
  await db.adminUser.create({
    data: { username: config.adminUsername, passwordHash },
  })
}
```

- [ ] **Step 4: Create `apps/backend/src/plugins/auth.ts`**

```typescript
import fp from 'fastify-plugin'
import { getClient } from '@wedding/db'
import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    adminUserId?: string
  }
}

export const authPlugin = fp(async (fastify: FastifyInstance) => {
  fastify.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies['session']
    if (!token) {
      return reply.code(401).send({ type: 'unauthorized', title: 'Unauthorized', status: 401 })
    }

    const db = getClient()
    const session = await db.session.findUnique({
      where: { token },
      include: { admin: true },
    })

    if (!session || session.expiresAt < new Date()) {
      return reply.code(401).send({ type: 'unauthorized', title: 'Session expired', status: 401 })
    }

    req.adminUserId = session.adminUserId
  })
})
```

- [ ] **Step 5: Create `apps/backend/src/routes/admin/auth.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { getClient } from '@wedding/db'

const LOCK_THRESHOLD = 5
const LOCK_DURATION_MS = 15 * 60 * 1000 // 15 min
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export async function adminAuthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/admin/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 64 },
          password: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
  }, async (req, reply) => {
    const { username, password } = req.body as { username: string; password: string }
    const db = getClient()

    // Timing-safe: always do bcrypt compare to prevent user enumeration
    const user = await db.adminUser.findUnique({ where: { username } })
    const dummyHash = '$2a$12$dummy.hash.to.prevent.timing.attack.000000000000000000000'
    const hashToCheck = user?.passwordHash ?? dummyHash

    const isLocked = user?.lockedUntil && user.lockedUntil > new Date()
    if (isLocked) {
      return reply.code(401).send({ type: 'unauthorized', title: 'Account locked', status: 401 })
    }

    const valid = await bcrypt.compare(password, hashToCheck)

    if (!user || !valid) {
      if (user) {
        const newAttempts = user.failedAttempts + 1
        const lockedUntil = newAttempts >= LOCK_THRESHOLD
          ? new Date(Date.now() + LOCK_DURATION_MS)
          : null
        await db.adminUser.update({
          where: { id: user.id },
          data: { failedAttempts: newAttempts, lockedUntil },
        })
      }
      return reply.code(401).send({ type: 'unauthorized', title: 'Invalid credentials', status: 401 })
    }

    // Reset failed attempts
    await db.adminUser.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    })

    const token = randomBytes(32).toString('hex')
    await db.session.create({
      data: {
        adminUserId: user.id,
        token,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    })

    reply.setCookie('session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MS / 1000,
      path: '/',
    })

    return reply.send({ ok: true })
  })

  fastify.post('/admin/logout', async (req, reply) => {
    const token = req.cookies['session']
    if (token) {
      const db = getClient()
      await db.session.deleteMany({ where: { token } }).catch(() => {})
    }
    reply.clearCookie('session', { path: '/' })
    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 6: Add fastify-plugin to dependencies**

In `apps/backend/package.json`, add to `dependencies`:
```json
"fastify-plugin": "^4.5.1"
```

Then run:
```bash
pnpm install
```

- [ ] **Step 7: Mount auth routes in server.ts — add to `buildApp`**

```typescript
// Add to server.ts after existing imports:
import { authPlugin } from './plugins/auth.js'
import { adminAuthRoutes } from './routes/admin/auth.js'

// Inside buildApp(), after existing plugin registrations:
await fastify.register(authPlugin)
await fastify.register(async (instance) => {
  await instance.register(adminAuthRoutes)
}, { prefix: '/api/v1' })
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm test tests/auth.test.ts
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/seed.ts apps/backend/src/plugins/auth.ts apps/backend/src/routes/admin/auth.ts apps/backend/tests/auth.test.ts apps/backend/src/server.ts
git commit -m "feat(backend): admin auth — login, logout, session, account lockout"
```

---

### Task 6: Gallery CRUD Routes

**Files:**
- Create: `apps/backend/src/routes/admin/galleries.ts`
- Create: `apps/backend/src/routes/guest/gallery.ts`
- Create: `apps/backend/tests/gallery.test.ts`

- [ ] **Step 1: Write failing gallery test**

Create `apps/backend/tests/gallery.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let sessionCookie: string
let weddingId: string
let galleryId: string

beforeAll(async () => {
  process.env.DATABASE_URL = 'file::memory:?cache=shared&uri=gallery-test'
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = 'Password123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-gallery-test'

  const config = loadConfig()
  app = await buildApp(config)
  await app.ready()

  const { seedAdmin } = await import('../src/seed.js')
  await seedAdmin(config)

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/login',
    payload: { username: 'admin', password: 'Password123!' },
  })
  sessionCookie = login.headers['set-cookie'] as string
})

afterAll(async () => {
  await app.close()
  await closeClient()
})

describe('POST /api/v1/admin/galleries', () => {
  it('creates a wedding + gallery', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/galleries',
      headers: { cookie: sessionCookie },
      payload: {
        weddingName: 'Emma & Max',
        weddingSlug: 'emma-max-2026',
        galleryName: 'Party',
        gallerySlug: 'party',
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    weddingId = body.weddingId
    galleryId = body.id
    expect(body.slug).toBe('party')
  })

  it('rejects invalid slug characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/galleries',
      headers: { cookie: sessionCookie },
      payload: {
        weddingName: 'Test',
        weddingSlug: 'test',
        galleryName: 'Bad Slug',
        gallerySlug: 'Bad Slug!!!',
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/v1/g/:slug', () => {
  it('returns gallery with photoCount', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/g/party' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.name).toBe('Party')
    expect(typeof body.photoCount).toBe('number')
    expect(body.pagination).toBeDefined()
  })

  it('returns 404 for unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/g/does-not-exist' })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /api/v1/admin/galleries/:id', () => {
  it('updates gallery settings', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/galleries/${galleryId}`,
      headers: { cookie: sessionCookie },
      payload: { allowGuestDownload: true, layout: 'GRID' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().allowGuestDownload).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/gallery.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `apps/backend/src/routes/admin/galleries.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { GalleryResponse, WeddingResponse } from '@wedding/shared'

const SLUG_PATTERN = /^[a-z0-9-]+$/

export async function adminGalleryRoutes(fastify: FastifyInstance): Promise<void> {
  // GET all weddings with galleries
  fastify.get('/admin/galleries', {
    preHandler: fastify.requireAdmin,
  }, async (_req, reply) => {
    const db = getClient()
    const weddings = await db.wedding.findMany({
      include: {
        galleries: {
          include: { _count: { select: { photos: true } } },
        },
      },
    })
    return reply.send(weddings.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      galleries: w.galleries.map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        description: g.description,
        layout: g.layout,
        allowGuestDownload: g.allowGuestDownload,
        guestNameMode: g.guestNameMode,
        photoCount: g._count.photos,
      } satisfies GalleryResponse)),
    } satisfies WeddingResponse)))
  })

  // POST create wedding + first gallery
  fastify.post('/admin/galleries', {
    preHandler: fastify.requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['weddingName', 'weddingSlug', 'galleryName', 'gallerySlug'],
        properties: {
          weddingName: { type: 'string', minLength: 1, maxLength: 100 },
          weddingSlug: { type: 'string', pattern: '^[a-z0-9-]+$', minLength: 1, maxLength: 60 },
          galleryName: { type: 'string', minLength: 1, maxLength: 100 },
          gallerySlug: { type: 'string', pattern: '^[a-z0-9-]+$', minLength: 1, maxLength: 60 },
          description: { type: 'string', maxLength: 500 },
          layout: { type: 'string', enum: ['MASONRY', 'GRID'] },
          allowGuestDownload: { type: 'boolean' },
          guestNameMode: { type: 'string', enum: ['OPTIONAL', 'REQUIRED', 'HIDDEN'] },
          moderationMode: { type: 'string', enum: ['MANUAL', 'AUTO'] },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      weddingName: string
      weddingSlug: string
      galleryName: string
      gallerySlug: string
      description?: string
      layout?: 'MASONRY' | 'GRID'
      allowGuestDownload?: boolean
      guestNameMode?: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
      moderationMode?: 'MANUAL' | 'AUTO'
    }

    const db = getClient()

    const wedding = await db.wedding.upsert({
      where: { slug: body.weddingSlug },
      create: { name: body.weddingName, slug: body.weddingSlug },
      update: {},
    })

    const existing = await db.gallery.findUnique({
      where: { weddingId_slug: { weddingId: wedding.id, slug: body.gallerySlug } },
    })
    if (existing) {
      return reply.code(409).send({ type: 'conflict', title: 'Gallery slug already exists', status: 409 })
    }

    const gallery = await db.gallery.create({
      data: {
        weddingId: wedding.id,
        name: body.galleryName,
        slug: body.gallerySlug,
        description: body.description,
        layout: body.layout ?? 'MASONRY',
        allowGuestDownload: body.allowGuestDownload ?? false,
        guestNameMode: body.guestNameMode ?? 'OPTIONAL',
        moderationMode: body.moderationMode ?? 'MANUAL',
      },
    })

    return reply.code(201).send({ ...gallery, weddingId: wedding.id, photoCount: 0 })
  })

  // PATCH update gallery settings
  fastify.patch('/admin/galleries/:id', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          layout: { type: 'string', enum: ['MASONRY', 'GRID'] },
          allowGuestDownload: { type: 'boolean' },
          guestNameMode: { type: 'string', enum: ['OPTIONAL', 'REQUIRED', 'HIDDEN'] },
          moderationMode: { type: 'string', enum: ['MANUAL', 'AUTO'] },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as Record<string, unknown>
    const db = getClient()

    const gallery = await db.gallery.update({ where: { id }, data: body })
    const count = await db.photo.count({ where: { galleryId: id } })
    return reply.send({ ...gallery, photoCount: count })
  })

  // DELETE gallery
  fastify.delete('/admin/galleries/:id', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getClient()
    await db.photo.deleteMany({ where: { galleryId: id } })
    await db.gallery.delete({ where: { id } })
    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 4: Create `apps/backend/src/routes/guest/gallery.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { PhotoResponse, PaginatedResponse } from '@wedding/shared'

export async function guestGalleryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/g/:slug', {
    schema: {
      params: { type: 'object', properties: { slug: { type: 'string', pattern: '^[a-z0-9-]+$' } } },
      querystring: {
        type: 'object',
        properties: {
          cursor: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const { cursor, limit = 20 } = req.query as { cursor?: string; limit?: number }
    const db = getClient()

    const gallery = await db.gallery.findFirst({
      where: { slug },
      include: { wedding: true },
    })
    if (!gallery) {
      return reply.code(404).send({
        type: 'gallery-not-found',
        title: 'Gallery Not Found',
        status: 404,
        detail: `No gallery found with slug "${slug}"`,
      })
    }

    const photos = await db.photo.findMany({
      where: {
        galleryId: gallery.id,
        status: 'APPROVED',
        deletedAt: null,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    })

    const hasMore = photos.length > limit
    const items = photos.slice(0, limit)
    const nextCursor = hasMore ? items[items.length - 1].id : null

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''

    const photoCount = await db.photo.count({
      where: { galleryId: gallery.id, status: 'APPROVED', deletedAt: null },
    })

    return reply.send({
      id: gallery.id,
      name: gallery.name,
      slug: gallery.slug,
      description: gallery.description,
      layout: gallery.layout,
      allowGuestDownload: gallery.allowGuestDownload,
      guestNameMode: gallery.guestNameMode,
      photoCount,
      data: items.map((p): PhotoResponse => ({
        id: p.id,
        mediaType: p.mediaType as 'IMAGE' | 'VIDEO',
        thumbUrl: `${apiBase}/api/v1/files/${gallery.slug}/${p.id}?v=thumb`,
        displayUrl: `${apiBase}/api/v1/files/${gallery.slug}/${p.id}?v=display`,
        duration: p.duration,
        guestName: p.guestName,
        createdAt: p.createdAt.toISOString(),
      })),
      pagination: { nextCursor, hasMore } satisfies PaginatedResponse<PhotoResponse>['pagination'],
    })
  })
}
```

- [ ] **Step 5: Mount new routes in `server.ts`**

Add to the `buildApp` function in `apps/backend/src/server.ts`:

```typescript
// Additional imports at top of server.ts:
import { adminGalleryRoutes } from './routes/admin/galleries.js'
import { guestGalleryRoutes } from './routes/guest/gallery.js'

// Inside buildApp(), in the prefix block:
await fastify.register(async (instance) => {
  await instance.register(adminAuthRoutes)
  await instance.register(adminGalleryRoutes)
  await instance.register(guestGalleryRoutes)
}, { prefix: '/api/v1' })
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm test tests/gallery.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/routes/admin/galleries.ts apps/backend/src/routes/guest/gallery.ts apps/backend/tests/gallery.test.ts apps/backend/src/server.ts
git commit -m "feat(backend): gallery CRUD and guest gallery endpoint"
```

---

### Task 7: File Upload Route

**Files:**
- Create: `apps/backend/src/routes/guest/upload.ts`
- Create: `apps/backend/src/routes/admin/upload.ts`
- Create: `apps/backend/tests/upload.test.ts`

- [ ] **Step 1: Write failing upload test**

Create `apps/backend/tests/upload.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'

let app: FastifyInstance
let sessionCookie: string
let gallerySlug: string

beforeAll(async () => {
  process.env.DATABASE_URL = 'file::memory:?cache=shared&uri=upload-test'
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = 'Password123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-upload-test'

  const config = loadConfig()
  app = await buildApp(config)
  await app.ready()

  const { seedAdmin } = await import('../src/seed.js')
  await seedAdmin(config)

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/login',
    payload: { username: 'admin', password: 'Password123!' },
  })
  sessionCookie = login.headers['set-cookie'] as string

  // Create a test gallery
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/galleries',
    headers: { cookie: sessionCookie },
    payload: {
      weddingName: 'Upload Test Wedding',
      weddingSlug: 'upload-test-wedding',
      galleryName: 'Uploads',
      gallerySlug: 'uploads',
    },
  })
  gallerySlug = createRes.json().slug
})

afterAll(async () => {
  await app.close()
  await closeClient()
})

describe('POST /api/v1/g/:slug/upload', () => {
  it('accepts a valid JPEG and returns PENDING status', async () => {
    const jpegBuf = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#aabbcc' },
    }).jpeg().toBuffer()

    const form = new FormData()
    form.append('file', new Blob([jpegBuf], { type: 'image/jpeg' }), 'test.jpg')

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      payload: form,
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.status).toBe('PENDING')
    expect(body.mediaType).toBe('IMAGE')
    expect(body.thumbUrl).toBeTruthy()
  })

  it('returns 409 on duplicate upload (same file)', async () => {
    const jpegBuf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#ff0000' },
    }).jpeg().toBuffer()

    const form1 = new FormData()
    form1.append('file', new Blob([jpegBuf], { type: 'image/jpeg' }), 'dup.jpg')
    await app.inject({ method: 'POST', url: `/api/v1/g/${gallerySlug}/upload`, payload: form1 })

    const form2 = new FormData()
    form2.append('file', new Blob([jpegBuf], { type: 'image/jpeg' }), 'dup.jpg')
    const res2 = await app.inject({ method: 'POST', url: `/api/v1/g/${gallerySlug}/upload`, payload: form2 })

    expect(res2.statusCode).toBe(409)
    expect(res2.json().type).toContain('duplicate')
  })

  it('returns 415 for disallowed MIME type', async () => {
    const form = new FormData()
    form.append('file', new Blob(['<html>attack</html>'], { type: 'text/html' }), 'bad.html')

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/g/${gallerySlug}/upload`,
      payload: form,
    })
    expect(res.statusCode).toBe(415)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/upload.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `apps/backend/src/routes/guest/upload.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { fileTypeFromBuffer } from 'file-type'
import { getClient } from '@wedding/db'
import { processImage, processVideo, computeSha256 } from '../../services/media.js'
import type { StorageService } from '../../services/storage.js'
import type { SseManager } from '../../services/sse.js'
import type { UploadResponse, PhotoResponse } from '@wedding/shared'

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'video/mp4', 'video/quicktime',
])

export async function guestUploadRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService; sse: SseManager }
): Promise<void> {
  fastify.post('/g/:slug/upload', {
    schema: {
      params: { type: 'object', properties: { slug: { type: 'string', pattern: '^[a-z0-9-]+$' } } },
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const db = getClient()

    const gallery = await db.gallery.findFirst({ where: { slug } })
    if (!gallery) {
      return reply.code(404).send({ type: 'gallery-not-found', title: 'Gallery Not Found', status: 404 })
    }

    const data = await req.file()
    if (!data) {
      return reply.code(400).send({ type: 'bad-request', title: 'No file provided', status: 400 })
    }

    const buffer = await data.toBuffer()
    const detectedType = await fileTypeFromBuffer(buffer)

    if (!detectedType || !ALLOWED_MIMES.has(detectedType.mime)) {
      return reply.code(415).send({
        type: 'unsupported-mime-type',
        title: 'Unsupported Media Type',
        status: 415,
        detail: `MIME type "${detectedType?.mime ?? 'unknown'}" is not allowed.`,
      })
    }

    const fileHash = computeSha256(buffer)
    const existingDup = await db.photo.findUnique({
      where: { galleryId_fileHash: { galleryId: gallery.id, fileHash } },
    })
    if (existingDup) {
      return reply.code(409).send({
        type: 'duplicate-photo',
        title: 'Duplicate Photo',
        status: 409,
        detail: 'This photo has already been uploaded to this gallery.',
      })
    }

    const isVideo = detectedType.mime.startsWith('video/')
    const photoId = `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`

    let thumbPath: string
    let displayPath: string
    let posterPath: string | null = null
    let blurDataUrl: string
    let duration: number | null = null

    if (!isVideo) {
      const result = await processImage(buffer, detectedType.mime)
      await opts.storage.save(slug, `${photoId}_thumb.webp`, result.thumb)
      await opts.storage.save(slug, `${photoId}_display.webp`, result.display)
      await opts.storage.save(slug, `${photoId}_original.webp`, result.original)
      thumbPath = `${photoId}_thumb.webp`
      displayPath = `${photoId}_display.webp`
      blurDataUrl = result.blurDataUrl
    } else {
      const result = await processVideo(buffer)
      const ext = detectedType.mime === 'video/quicktime' ? 'mov' : 'mp4'
      await opts.storage.save(slug, `${photoId}_original.${ext}`, buffer)
      await opts.storage.save(slug, `${photoId}_poster.webp`, result.poster)
      thumbPath = `${photoId}_poster.webp`
      displayPath = `${photoId}_original.${ext}`
      posterPath = `${photoId}_poster.webp`
      blurDataUrl = result.blurDataUrl
      duration = result.durationSeconds
    }

    const guestName = (data.fields?.guestName as { value: string } | undefined)?.value ?? null

    const autoApprove = gallery.moderationMode === 'AUTO'

    const photo = await db.photo.create({
      data: {
        id: photoId,
        galleryId: gallery.id,
        guestName,
        fileHash,
        mediaType: isVideo ? 'VIDEO' : 'IMAGE',
        originalPath: isVideo ? displayPath : `${photoId}_original.webp`,
        thumbPath,
        displayPath,
        posterPath,
        blurDataUrl,
        duration,
        mimeType: detectedType.mime,
        exifStripped: !isVideo,
        status: autoApprove ? 'APPROVED' : 'PENDING',
      },
    })

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''
    const thumbUrl = `${apiBase}/api/v1/files/${slug}/${photo.id}?v=thumb`

    if (autoApprove) {
      const photoResponse: PhotoResponse = {
        id: photo.id,
        mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
        thumbUrl,
        displayUrl: `${apiBase}/api/v1/files/${slug}/${photo.id}?v=display`,
        duration: photo.duration,
        guestName: photo.guestName,
        createdAt: photo.createdAt.toISOString(),
      }
      opts.sse.broadcast(gallery.id, 'new-photo', photoResponse)
    }

    const response: UploadResponse = {
      id: photo.id,
      status: photo.status as 'PENDING' | 'APPROVED',
      mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
      thumbUrl,
      duration: photo.duration,
    }

    return reply.code(201).send(response)
  })
}
```

- [ ] **Step 4: Update `server.ts` to inject storage + sse into upload route**

In `apps/backend/src/server.ts`, update `buildApp` to accept and wire services:

```typescript
import { createStorage } from './services/storage.js'
import { createSseManager } from './services/sse.js'
import { guestUploadRoutes } from './routes/guest/upload.js'

export async function buildApp(config: AppConfig) {
  // ... existing code ...

  const storage = createStorage({
    provider: config.storageProvider,
    localPath: config.storageLocalPath,
  })
  const sse = createSseManager()

  // Attach to fastify instance for other routes to use
  fastify.decorate('storage', storage)
  fastify.decorate('sse', sse)

  await fastify.register(async (instance) => {
    await instance.register(adminAuthRoutes)
    await instance.register(adminGalleryRoutes)
    await instance.register(guestGalleryRoutes)
    await instance.register(guestUploadRoutes, { storage, sse })
  }, { prefix: '/api/v1' })

  return fastify
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test tests/upload.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/guest/upload.ts apps/backend/tests/upload.test.ts apps/backend/src/server.ts
git commit -m "feat(backend): guest file upload with MIME validation, dedup, sharp/ffmpeg processing"
```

---

### Task 8: Moderation Routes

**Files:**
- Create: `apps/backend/src/routes/admin/photos.ts`
- Create: `apps/backend/tests/moderation.test.ts`

- [ ] **Step 1: Write failing moderation test**

Create `apps/backend/tests/moderation.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { closeClient, getClient } from '@wedding/db'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'

let app: FastifyInstance
let sessionCookie: string
let gallerySlug: string
let photoId: string

beforeAll(async () => {
  process.env.DATABASE_URL = 'file::memory:?cache=shared&uri=mod-test'
  process.env.SESSION_SECRET = 'test-secret-32-chars-xxxxxxxxxxxx'
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = 'Password123!'
  process.env.FRONTEND_URL = 'http://localhost:3000'
  process.env.STORAGE_LOCAL_PATH = '/tmp/wps-mod-test'

  const config = loadConfig()
  app = await buildApp(config)
  await app.ready()

  const { seedAdmin } = await import('../src/seed.js')
  await seedAdmin(config)

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/login',
    payload: { username: 'admin', password: 'Password123!' },
  })
  sessionCookie = login.headers['set-cookie'] as string

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/galleries',
    headers: { cookie: sessionCookie },
    payload: { weddingName: 'Mod Test', weddingSlug: 'mod-test', galleryName: 'Mod', gallerySlug: 'mod' },
  })
  gallerySlug = createRes.json().slug

  // Upload a photo to moderate
  const jpegBuf = await sharp({
    create: { width: 100, height: 100, channels: 3, background: '#123456' },
  }).jpeg().toBuffer()

  const form = new FormData()
  form.append('file', new Blob([jpegBuf], { type: 'image/jpeg' }), 'mod-test.jpg')

  const uploadRes = await app.inject({
    method: 'POST',
    url: `/api/v1/g/${gallerySlug}/upload`,
    payload: form,
  })
  photoId = uploadRes.json().id
})

afterAll(async () => {
  await app.close()
  await closeClient()
})

describe('GET /api/v1/admin/galleries/:id/photos', () => {
  it('returns pending photos for admin', async () => {
    const gallery = await getClient().gallery.findFirst({ where: { slug: gallerySlug } })
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/galleries/${gallery!.id}/photos?status=PENDING`,
      headers: { cookie: sessionCookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBeGreaterThan(0)
  })
})

describe('PATCH /api/v1/admin/photos/:id', () => {
  it('approves a photo and broadcasts SSE', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/photos/${photoId}`,
      headers: { cookie: sessionCookie },
      payload: { status: 'APPROVED' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('APPROVED')
  })
})

describe('POST /api/v1/admin/photos/batch', () => {
  it('rejects multiple photos at once', async () => {
    // Upload two more photos
    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
      const buf = await sharp({
        create: { width: 50, height: 50, channels: 3, background: `#${i}${i}${i}${i}${i}${i}` },
      }).jpeg().toBuffer()
      const form = new FormData()
      form.append('file', new Blob([buf], { type: 'image/jpeg' }), `batch${i}.jpg`)
      const r = await app.inject({ method: 'POST', url: `/api/v1/g/${gallerySlug}/upload`, payload: form })
      ids.push(r.json().id)
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/photos/batch',
      headers: { cookie: sessionCookie },
      payload: { action: 'reject', photoIds: ids, rejectionReason: 'Not appropriate' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().processed).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/moderation.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `apps/backend/src/routes/admin/photos.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { SseManager } from '../../services/sse.js'
import type { PhotoResponse } from '@wedding/shared'

export async function adminPhotoRoutes(
  fastify: FastifyInstance,
  opts: { sse: SseManager }
): Promise<void> {
  // GET photos by gallery and status
  fastify.get('/admin/galleries/:id/photos', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
          cursor: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { status, cursor, limit = 50 } = req.query as {
      status?: 'PENDING' | 'APPROVED' | 'REJECTED'
      cursor?: string
      limit?: number
    }

    const db = getClient()
    const gallery = await db.gallery.findUnique({ where: { id } })
    if (!gallery) return reply.code(404).send({ type: 'gallery-not-found', status: 404 })

    const photos = await db.photo.findMany({
      where: {
        galleryId: id,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    })

    const hasMore = photos.length > limit
    const items = photos.slice(0, limit)
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''

    return reply.send({
      data: items.map((p) => ({
        id: p.id,
        mediaType: p.mediaType,
        thumbUrl: `${apiBase}/api/v1/files/${gallery.slug}/${p.id}?v=thumb`,
        displayUrl: `${apiBase}/api/v1/files/${gallery.slug}/${p.id}?v=display`,
        duration: p.duration,
        guestName: p.guestName,
        status: p.status,
        rejectionReason: p.rejectionReason,
        createdAt: p.createdAt.toISOString(),
      })),
      pagination: { nextCursor: hasMore ? items[items.length - 1].id : null, hasMore },
    })
  })

  // PATCH single photo (approve/reject)
  fastify.patch('/admin/photos/:id', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
          rejectionReason: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { status, rejectionReason } = req.body as {
      status: 'APPROVED' | 'REJECTED'
      rejectionReason?: string
    }

    const db = getClient()
    const photo = await db.photo.update({
      where: { id },
      data: { status, rejectionReason: rejectionReason ?? null },
      include: { gallery: true },
    })

    if (status === 'APPROVED') {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''
      const photoResponse: PhotoResponse = {
        id: photo.id,
        mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
        thumbUrl: `${apiBase}/api/v1/files/${photo.gallery.slug}/${photo.id}?v=thumb`,
        displayUrl: `${apiBase}/api/v1/files/${photo.gallery.slug}/${photo.id}?v=display`,
        duration: photo.duration,
        guestName: photo.guestName,
        createdAt: photo.createdAt.toISOString(),
      }
      opts.sse.broadcast(photo.galleryId, 'new-photo', photoResponse)
    }

    return reply.send({ ...photo, status: photo.status })
  })

  // POST batch action
  fastify.post('/admin/photos/batch', {
    preHandler: fastify.requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['action', 'photoIds'],
        properties: {
          action: { type: 'string', enum: ['approve', 'reject'] },
          photoIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
          rejectionReason: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    const { action, photoIds, rejectionReason } = req.body as {
      action: 'approve' | 'reject'
      photoIds: string[]
      rejectionReason?: string
    }

    const db = getClient()
    const status = action === 'approve' ? 'APPROVED' : 'REJECTED'

    const result = await db.photo.updateMany({
      where: { id: { in: photoIds } },
      data: { status, rejectionReason: action === 'reject' ? (rejectionReason ?? null) : null },
    })

    if (status === 'APPROVED') {
      const photos = await db.photo.findMany({
        where: { id: { in: photoIds } },
        include: { gallery: true },
      })
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''
      for (const photo of photos) {
        const photoResponse: PhotoResponse = {
          id: photo.id,
          mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
          thumbUrl: `${apiBase}/api/v1/files/${photo.gallery.slug}/${photo.id}?v=thumb`,
          displayUrl: `${apiBase}/api/v1/files/${photo.gallery.slug}/${photo.id}?v=display`,
          duration: photo.duration,
          guestName: photo.guestName,
          createdAt: photo.createdAt.toISOString(),
        }
        opts.sse.broadcast(photo.galleryId, 'new-photo', photoResponse)
      }
    }

    return reply.send({ processed: result.count, failed: [] })
  })

  // DELETE single photo (soft delete)
  fastify.delete('/admin/photos/:id', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getClient()
    await db.photo.update({ where: { id }, data: { deletedAt: new Date() } })
    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 4: Wire photo routes in `server.ts`**

Add to `buildApp` in `apps/backend/src/server.ts`:

```typescript
import { adminPhotoRoutes } from './routes/admin/photos.js'

// Inside the prefix block:
await instance.register(adminPhotoRoutes, { sse })
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test tests/moderation.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/admin/photos.ts apps/backend/tests/moderation.test.ts apps/backend/src/server.ts
git commit -m "feat(backend): moderation routes — approve, reject, batch, soft-delete"
```

---

### Task 9: SSE Slideshow Route + Media Serving + QR + ZIP

**Files:**
- Create: `apps/backend/src/routes/guest/slideshow.ts`
- Create: `apps/backend/src/routes/files.ts`
- Create: `apps/backend/src/routes/guest/qr.ts`
- Create: `apps/backend/src/routes/guest/download.ts`
- Create: `apps/backend/src/routes/admin/export.ts`

- [ ] **Step 1: Create `apps/backend/src/routes/guest/slideshow.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { SseManager } from '../../services/sse.js'
import { randomUUID } from 'crypto'

const HEARTBEAT_INTERVAL_MS = 30_000

export async function guestSlideshowRoutes(
  fastify: FastifyInstance,
  opts: { sse: SseManager }
): Promise<void> {
  fastify.get('/g/:slug/slideshow/stream', {
    schema: {
      params: { type: 'object', properties: { slug: { type: 'string', pattern: '^[a-z0-9-]+$' } } },
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const db = getClient()

    const gallery = await db.gallery.findFirst({ where: { slug } })
    if (!gallery) {
      return reply.code(404).send({ type: 'gallery-not-found', status: 404 })
    }

    const connectionId = randomUUID()

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const send = (data: string) => reply.raw.write(data)

    opts.sse.add(gallery.id, connectionId, send)
    fastify.log.debug({ galleryId: gallery.id, connectionId }, 'sse.connect')

    const heartbeat = setInterval(() => {
      opts.sse.sendHeartbeat(gallery.id)
    }, HEARTBEAT_INTERVAL_MS)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      opts.sse.remove(gallery.id, connectionId)
      fastify.log.debug({ galleryId: gallery.id, connectionId }, 'sse.disconnect')
    })

    // Send initial ping so the client knows the connection is live
    send(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)

    // Keep connection open — don't call reply.send()
    await new Promise<void>((resolve) => req.raw.on('close', resolve))
  })
}
```

- [ ] **Step 2: Create `apps/backend/src/routes/files.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'fs'
import { join } from 'path'
import { getClient } from '@wedding/db'
import type { StorageService } from '../services/storage.js'

const VARIANT_MAP: Record<string, string> = {
  thumb: '_thumb.webp',
  display: '_display.webp',
  original: '_original',
  poster: '_poster.webp',
}

export async function fileRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService }
): Promise<void> {
  fastify.get('/files/:gallerySlug/:photoId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          gallerySlug: { type: 'string', pattern: '^[a-z0-9-]+$' },
          photoId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          v: { type: 'string', enum: ['thumb', 'display', 'original', 'poster'] },
        },
      },
    },
  }, async (req, reply) => {
    const { gallerySlug, photoId } = req.params as { gallerySlug: string; photoId: string }
    const { v = 'display' } = req.query as { v?: string }

    // Validate photoId contains no path traversal
    if (photoId.includes('/') || photoId.includes('..') || photoId.includes('\0')) {
      return reply.code(400).send({ type: 'bad-request', status: 400 })
    }

    const db = getClient()
    const photo = await db.photo.findFirst({
      where: { id: photoId, gallery: { slug: gallerySlug }, deletedAt: null },
      include: { gallery: true },
    })

    if (!photo) return reply.code(404).send({ type: 'not-found', status: 404 })

    let filename: string
    let contentType: string

    if (v === 'thumb') {
      filename = photo.thumbPath
      contentType = 'image/webp'
    } else if (v === 'display') {
      filename = photo.displayPath
      contentType = photo.mediaType === 'VIDEO' ? photo.mimeType : 'image/webp'
    } else if (v === 'poster' && photo.posterPath) {
      filename = photo.posterPath
      contentType = 'image/webp'
    } else {
      filename = photo.originalPath
      contentType = photo.mimeType
    }

    const filePath = opts.storage.filePath(gallerySlug, filename)

    reply.header('Content-Type', contentType)
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')

    const stream = createReadStream(filePath)
    return reply.send(stream)
  })
}
```

- [ ] **Step 3: Create `apps/backend/src/routes/guest/qr.ts`**

```typescript
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
```

- [ ] **Step 4: Create `apps/backend/src/routes/guest/download.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import archiver from 'archiver'
import { createReadStream } from 'fs'
import { getClient } from '@wedding/db'
import type { StorageService } from '../../services/storage.js'

export async function guestDownloadRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService }
): Promise<void> {
  fastify.get('/g/:slug/download', {
    schema: {
      params: { type: 'object', properties: { slug: { type: 'string', pattern: '^[a-z0-9-]+$' } } },
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const db = getClient()

    const gallery = await db.gallery.findFirst({ where: { slug } })
    if (!gallery) return reply.code(404).send({ type: 'gallery-not-found', status: 404 })
    if (!gallery.allowGuestDownload) {
      return reply.code(403).send({ type: 'forbidden', title: 'Download not allowed', status: 403 })
    }

    const photos = await db.photo.findMany({
      where: { galleryId: gallery.id, status: 'APPROVED', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${slug}-photos.zip"`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    reply.raw.on('close', () => archive.abort())

    archive.pipe(reply.raw)

    for (const photo of photos) {
      const filename = photo.originalPath
      const stream = createReadStream(opts.storage.filePath(slug, filename))
      const ext = filename.split('.').pop() ?? 'jpg'
      archive.append(stream, { name: `${photo.id}.${ext}` })
    }

    await archive.finalize()
  })
}
```

- [ ] **Step 5: Create `apps/backend/src/routes/admin/export.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import archiver from 'archiver'
import { createReadStream } from 'fs'
import { getClient } from '@wedding/db'
import type { StorageService } from '../../services/storage.js'

export async function adminExportRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService }
): Promise<void> {
  fastify.get('/admin/galleries/:id/export', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getClient()

    const gallery = await db.gallery.findUnique({ where: { id } })
    if (!gallery) return reply.code(404).send({ type: 'gallery-not-found', status: 404 })

    const photos = await db.photo.findMany({
      where: { galleryId: id, status: 'APPROVED', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${gallery.slug}-export.zip"`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.pipe(reply.raw)

    for (const photo of photos) {
      const stream = createReadStream(opts.storage.filePath(gallery.slug, photo.originalPath))
      const ext = photo.originalPath.split('.').pop() ?? 'jpg'
      archive.append(stream, { name: `${photo.id}.${ext}` })
    }

    await archive.finalize()
  })
}
```

- [ ] **Step 6: Mount all new routes in `server.ts`**

```typescript
// Add imports at top of server.ts:
import { guestSlideshowRoutes } from './routes/guest/slideshow.js'
import { fileRoutes } from './routes/files.js'
import { guestQrRoutes } from './routes/guest/qr.js'
import { guestDownloadRoutes } from './routes/guest/download.js'
import { adminExportRoutes } from './routes/admin/export.js'

// Inside the prefix block in buildApp:
await instance.register(guestSlideshowRoutes, { sse })
await instance.register(guestQrRoutes)
await instance.register(guestDownloadRoutes, { storage })
await instance.register(adminExportRoutes, { storage })
await instance.register(fileRoutes, { storage })
```

- [ ] **Step 7: Run all backend tests**

```bash
cd apps/backend && pnpm test
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/routes/ apps/backend/src/server.ts
git commit -m "feat(backend): SSE slideshow, file serving, QR generation, ZIP export"
```

---

### Task 10: Seed + main.ts Integration

**Files:**
- Modify: `apps/backend/src/main.ts`

- [ ] **Step 1: Update `apps/backend/src/main.ts`**

```typescript
import { loadConfig } from './config.js'
import { buildApp } from './server.js'
import { seedAdmin } from './seed.js'

const config = loadConfig()
const app = await buildApp(config)

await seedAdmin(config)

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
  app.log.info(`Backend running on port ${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
```

- [ ] **Step 2: Build and verify TypeScript compiles**

```bash
cd apps/backend && pnpm build
```

Expected: `dist/` created, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/main.ts
git commit -m "feat(backend): wire config + seed into main entry point"
```
