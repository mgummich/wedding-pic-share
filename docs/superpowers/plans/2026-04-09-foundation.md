# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the monorepo skeleton — pnpm workspaces, Turborepo, shared packages, bare app skeletons, Docker setup, and CI pipeline — so that `docker compose up` starts both services and both pass health checks.

**Architecture:** pnpm monorepo with `apps/frontend` (Next.js) and `apps/backend` (Fastify) sharing `packages/db` (Prisma) and `packages/shared` (TypeScript types). Turborepo orchestrates builds in the correct dependency order.

**Tech Stack:** Node 20, pnpm 9, Turborepo 2, TypeScript 5, Prisma 6, Next.js 15, Fastify 5, Vitest, Docker (node:20-alpine), GitHub Actions

---

## File Map

| File | Responsibility |
|---|---|
| `package.json` | Root workspace manifest, shared scripts |
| `pnpm-workspace.yaml` | Declares workspace packages |
| `turbo.json` | Build pipeline / dependency graph |
| `packages/shared/package.json` | Shared types package manifest |
| `packages/shared/src/types/photo.ts` | PhotoResponse, UploadResponse types |
| `packages/shared/src/types/gallery.ts` | GalleryResponse type |
| `packages/shared/src/index.ts` | Re-exports |
| `packages/shared/tsconfig.json` | TypeScript config for shared |
| `packages/db/package.json` | DB package manifest |
| `packages/db/prisma/schema.prisma` | Full Prisma schema (Phase 1) |
| `packages/db/src/client.ts` | Prisma client + WAL-mode hook |
| `packages/db/src/index.ts` | Re-exports |
| `packages/db/tsconfig.json` | TypeScript config for db |
| `apps/backend/package.json` | Backend manifest |
| `apps/backend/src/server.ts` | Fastify factory function |
| `apps/backend/src/main.ts` | Entry point (listen) |
| `apps/backend/src/routes/health.ts` | GET /health + GET /ready |
| `apps/backend/tsconfig.json` | TypeScript config |
| `apps/backend/vitest.config.ts` | Vitest config |
| `apps/backend/tests/health.test.ts` | Health check integration test |
| `apps/frontend/package.json` | Frontend manifest |
| `apps/frontend/src/app/layout.tsx` | Root layout (fonts, CSS) |
| `apps/frontend/src/app/page.tsx` | Minimal root page |
| `apps/frontend/tailwind.config.ts` | Tailwind + design tokens |
| `apps/frontend/tsconfig.json` | TypeScript config |
| `apps/frontend/next.config.ts` | Next.js config |
| `Dockerfile.backend` | Multi-stage Alpine backend image |
| `Dockerfile.frontend` | Multi-stage Alpine frontend image |
| `docker-compose.yml` | Full compose setup |
| `.env.example` | All environment variables documented |
| `.github/workflows/ci.yml` | Lint + test + build CI |

---

### Task 1: Monorepo Root Scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.gitignore`
- Create: `.nvmrc`

- [ ] **Step 1: Create `.nvmrc`**

```
20
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "wedding-pic-share",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "db:generate": "turbo run db:generate",
    "db:migrate": "cd packages/db && pnpm prisma migrate deploy"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9.0.0"
}
```

- [ ] **Step 4: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "db:generate": {
      "outputs": ["node_modules/.prisma/**"]
    }
  }
}
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
.next/
.turbo/
*.db
*.db-shm
*.db-wal
data/
coverage/
.env
.env.local
```

- [ ] **Step 6: Install Turborepo**

```bash
pnpm install
```

Expected: `node_modules/` created at root.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json .gitignore .nvmrc
git commit -m "chore: init monorepo root (pnpm workspaces + turborepo)"
```

---

### Task 2: `packages/shared` — API Response Types

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types/photo.ts`
- Create: `packages/shared/src/types/gallery.ts`
- Create: `packages/shared/src/types/upload.ts`
- Create: `packages/shared/src/types/pagination.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/tests/types.test.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@wedding/shared",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src/"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing type test**

Create `packages/shared/tests/types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest'
import type {
  PhotoResponse,
  GalleryResponse,
  UploadResponse,
  PaginatedResponse,
} from '../src/index.js'

describe('shared types', () => {
  it('PhotoResponse has required fields', () => {
    expectTypeOf<PhotoResponse>().toHaveProperty('id')
    expectTypeOf<PhotoResponse>().toHaveProperty('mediaType')
    expectTypeOf<PhotoResponse>().toHaveProperty('thumbUrl')
    expectTypeOf<PhotoResponse>().toHaveProperty('displayUrl')
    expectTypeOf<PhotoResponse>().toHaveProperty('duration')
    expectTypeOf<PhotoResponse>().toHaveProperty('guestName')
    expectTypeOf<PhotoResponse>().toHaveProperty('createdAt')
  })

  it('GalleryResponse has required fields', () => {
    expectTypeOf<GalleryResponse>().toHaveProperty('id')
    expectTypeOf<GalleryResponse>().toHaveProperty('slug')
    expectTypeOf<GalleryResponse>().toHaveProperty('layout')
    expectTypeOf<GalleryResponse>().toHaveProperty('guestNameMode')
    expectTypeOf<GalleryResponse>().toHaveProperty('photoCount')
  })

  it('UploadResponse has required fields', () => {
    expectTypeOf<UploadResponse>().toHaveProperty('id')
    expectTypeOf<UploadResponse>().toHaveProperty('status')
    expectTypeOf<UploadResponse>().toHaveProperty('mediaType')
    expectTypeOf<UploadResponse>().toHaveProperty('thumbUrl')
    expectTypeOf<UploadResponse>().toHaveProperty('duration')
  })

  it('mediaType is IMAGE | VIDEO', () => {
    type MediaType = PhotoResponse['mediaType']
    expectTypeOf<MediaType>().toEqualTypeOf<'IMAGE' | 'VIDEO'>()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd packages/shared && pnpm test
```

Expected: FAIL with "Cannot find module '../src/index.js'"

- [ ] **Step 5: Create `packages/shared/src/types/photo.ts`**

```typescript
export interface PhotoResponse {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  thumbUrl: string
  displayUrl: string
  duration: number | null
  guestName: string | null
  createdAt: string
}
```

- [ ] **Step 6: Create `packages/shared/src/types/gallery.ts`**

```typescript
export interface GalleryResponse {
  id: string
  name: string
  slug: string
  description: string | null
  layout: 'MASONRY' | 'GRID'
  allowGuestDownload: boolean
  guestNameMode: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
  photoCount: number
}

export interface WeddingResponse {
  id: string
  name: string
  slug: string
  galleries: GalleryResponse[]
  createdAt: string
}
```

- [ ] **Step 7: Create `packages/shared/src/types/upload.ts`**

```typescript
export interface UploadResponse {
  id: string
  status: 'PENDING' | 'APPROVED'
  mediaType: 'IMAGE' | 'VIDEO'
  thumbUrl: string
  duration: number | null
}
```

- [ ] **Step 8: Create `packages/shared/src/types/pagination.ts`**

```typescript
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    nextCursor: string | null
    hasMore: boolean
  }
}
```

- [ ] **Step 9: Create `packages/shared/src/index.ts`**

```typescript
export type { PhotoResponse } from './types/photo.js'
export type { GalleryResponse, WeddingResponse } from './types/gallery.js'
export type { UploadResponse } from './types/upload.js'
export type { PaginatedResponse } from './types/pagination.js'
```

- [ ] **Step 10: Add vitest config `packages/shared/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
  },
})
```

- [ ] **Step 11: Run test to verify it passes**

```bash
cd packages/shared && pnpm test
```

Expected: PASS (4 tests)

- [ ] **Step 12: Build shared package**

```bash
cd packages/shared && pnpm build
```

Expected: `dist/` created with `.js` and `.d.ts` files.

- [ ] **Step 13: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add API response types"
```

---

### Task 3: `packages/db` — Prisma Schema + Migration

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/tests/client.test.ts`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@wedding/db",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc && pnpm prisma generate",
    "db:generate": "prisma generate",
    "db:migrate:dev": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src/"
  },
  "dependencies": {
    "@prisma/client": "^6.0.0"
  },
  "devDependencies": {
    "prisma": "^6.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/db/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

enum PhotoStatus {
  PENDING
  APPROVED
  REJECTED
}

enum MediaType {
  IMAGE
  VIDEO
}

enum GalleryLayout {
  MASONRY
  GRID
}

enum GuestNameMode {
  OPTIONAL
  REQUIRED
  HIDDEN
}

enum ModerationMode {
  MANUAL
  AUTO
}

// Phase 1
model Wedding {
  id        String    @id @default(cuid())
  name      String
  slug      String    @unique
  createdAt DateTime  @default(now())
  galleries Gallery[]
}

// Phase 1 (secretKey: Phase 3, uploadWindows: Phase 2)
model Gallery {
  id                 String         @id @default(cuid())
  weddingId          String
  wedding            Wedding        @relation(fields: [weddingId], references: [id])
  name               String
  slug               String
  description        String?
  coverImage         String?
  layout             GalleryLayout  @default(MASONRY)
  allowGuestDownload Boolean        @default(false)
  guestNameMode      GuestNameMode  @default(OPTIONAL)
  moderationMode     ModerationMode @default(MANUAL)
  secretKey          String?        // Phase 3: bcrypt-hashed PIN
  createdAt          DateTime       @default(now())
  photos             Photo[]

  @@unique([weddingId, slug])
}

// Phase 1
model Photo {
  id              String      @id @default(cuid())
  galleryId       String
  gallery         Gallery     @relation(fields: [galleryId], references: [id])
  guestName       String?
  fileHash        String
  mediaType       MediaType   @default(IMAGE)
  originalPath    String
  thumbPath       String
  displayPath     String
  posterPath      String?
  blurDataUrl     String      @default("")
  duration        Int?
  mimeType        String
  status          PhotoStatus @default(PENDING)
  rejectionReason String?
  exifStripped    Boolean     @default(false)
  deletedAt       DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@unique([galleryId, fileHash])
  @@index([galleryId, status, createdAt(sort: Desc)])
  @@index([galleryId, status])
}

// Phase 1
model AdminUser {
  id                  String    @id @default(cuid())
  username            String    @unique
  passwordHash        String
  totpSecretEncrypted String?   // Phase 3
  failedAttempts      Int       @default(0)
  lockedUntil         DateTime?
  sessions            Session[]
}

// Phase 1
model Session {
  id          String    @id @default(cuid())
  adminUserId String
  admin       AdminUser @relation(fields: [adminUserId], references: [id])
  token       String    @unique
  createdAt   DateTime  @default(now())
  expiresAt   DateTime
}
```

- [ ] **Step 4: Write the failing DB test**

Create `packages/db/tests/client.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getClient, closeClient } from '../src/index.js'

describe('prisma client', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    const db = getClient()
    await db.$executeRawUnsafe('PRAGMA journal_mode=WAL')
  })

  afterAll(async () => {
    await closeClient()
    const { unlink } = await import('fs/promises')
    await unlink('./test.db').catch(() => {})
    await unlink('./test.db-shm').catch(() => {})
    await unlink('./test.db-wal').catch(() => {})
  })

  it('connects to the database', async () => {
    const db = getClient()
    const result = await db.$queryRaw<[{ journal_mode: string }]>`PRAGMA journal_mode`
    expect(result[0].journal_mode).toBe('wal')
  })

  it('can create and retrieve a Wedding record', async () => {
    const db = getClient()
    const wedding = await db.wedding.create({
      data: { name: 'Test Wedding', slug: 'test-wedding' },
    })
    expect(wedding.id).toBeTruthy()
    expect(wedding.slug).toBe('test-wedding')

    const found = await db.wedding.findUnique({ where: { slug: 'test-wedding' } })
    expect(found?.name).toBe('Test Wedding')
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd packages/db && pnpm test
```

Expected: FAIL with "Cannot find module '../src/index.js'"

- [ ] **Step 6: Create `packages/db/src/client.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

let _client: PrismaClient | null = null

export function getClient(): PrismaClient {
  if (!_client) {
    _client = new PrismaClient()
    // Enable WAL mode for SQLite concurrent reads
    // For PostgreSQL, this is a no-op (raw SQL not affecting PG)
    const url = process.env.DATABASE_URL ?? ''
    if (url.startsWith('file:') || url.startsWith('sqlite:')) {
      _client.$connect().then(() => {
        _client!.$executeRaw`PRAGMA journal_mode=WAL`.catch(() => {})
        _client!.$executeRaw`PRAGMA synchronous=NORMAL`.catch(() => {})
        _client!.$executeRaw`PRAGMA busy_timeout=5000`.catch(() => {})
      })
    }
  }
  return _client
}

export async function closeClient(): Promise<void> {
  if (_client) {
    await _client.$disconnect()
    _client = null
  }
}
```

- [ ] **Step 7: Create `packages/db/src/index.ts`**

```typescript
export { getClient, closeClient } from './client.js'
export { PrismaClient } from '@prisma/client'
export type {
  Wedding,
  Gallery,
  Photo,
  AdminUser,
  Session,
  PhotoStatus,
  MediaType,
  GalleryLayout,
  GuestNameMode,
  ModerationMode,
} from '@prisma/client'
```

- [ ] **Step 8: Install dependencies and generate Prisma client**

```bash
cd packages/db && pnpm install
pnpm prisma generate
```

Expected: `node_modules/.prisma/client/` created.

- [ ] **Step 9: Run initial migration**

```bash
DATABASE_URL="file:./dev.db" pnpm prisma migrate dev --name init
```

Expected: `prisma/migrations/TIMESTAMP_init/migration.sql` created.

- [ ] **Step 10: Add vitest config `packages/db/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 10000,
  },
})
```

- [ ] **Step 11: Run test to verify it passes**

```bash
cd packages/db && pnpm test
```

Expected: PASS (2 tests)

- [ ] **Step 12: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add prisma schema and WAL-mode client"
```

---

### Task 4: `apps/backend` — Bare Fastify Server with Health Check

**Files:**
- Create: `apps/backend/package.json`
- Create: `apps/backend/tsconfig.json`
- Create: `apps/backend/vitest.config.ts`
- Create: `apps/backend/src/server.ts`
- Create: `apps/backend/src/main.ts`
- Create: `apps/backend/src/routes/health.ts`
- Create: `apps/backend/tests/health.test.ts`

- [ ] **Step 1: Create `apps/backend/package.json`**

```json
{
  "name": "@wedding/backend",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/main.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/main.ts",
    "start": "node dist/main.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.0",
    "@fastify/helmet": "^11.0.0",
    "@wedding/db": "workspace:*",
    "@wedding/shared": "workspace:*",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/backend/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
})
```

- [ ] **Step 4: Write the failing health check test**

Create `apps/backend/tests/health.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  process.env.DATABASE_URL = 'file::memory:?cache=shared'
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
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
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd apps/backend && pnpm install && pnpm test
```

Expected: FAIL with "Cannot find module '../src/server.js'"

- [ ] **Step 6: Create `apps/backend/src/routes/health.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_req, reply) => {
    let dbStatus: 'ok' | 'error' = 'ok'
    try {
      const db = getClient()
      await db.$queryRaw`SELECT 1`
    } catch {
      dbStatus = 'error'
    }

    const status = dbStatus === 'ok' ? 'ok' : 'degraded'
    const statusCode = status === 'ok' ? 200 : 503

    return reply.code(statusCode).send({
      status,
      db: dbStatus,
      uptime: Math.floor(process.uptime()),
    })
  })

  fastify.get('/ready', async (_req, reply) => {
    return reply.send({ ready: true })
  })
}
```

- [ ] **Step 7: Create `apps/backend/src/server.ts`**

```typescript
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import { healthRoutes } from './routes/health.js'

export async function buildApp() {
  const fastify = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  })

  await fastify.register(helmet)
  await fastify.register(cors, {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  })

  await fastify.register(healthRoutes)

  return fastify
}
```

- [ ] **Step 8: Create `apps/backend/src/main.ts`**

```typescript
import { buildApp } from './server.js'

const app = await buildApp()

try {
  await app.listen({
    port: Number(process.env.PORT ?? 4000),
    host: '0.0.0.0',
  })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
```

- [ ] **Step 9: Run test to verify it passes**

```bash
cd apps/backend && pnpm test
```

Expected: PASS (2 tests)

- [ ] **Step 10: Commit**

```bash
git add apps/backend/
git commit -m "feat(backend): bare fastify server with health + ready endpoints"
```

---

### Task 5: `apps/frontend` — Bare Next.js App with Design Tokens

**Files:**
- Create: `apps/frontend/package.json`
- Create: `apps/frontend/tsconfig.json`
- Create: `apps/frontend/next.config.ts`
- Create: `apps/frontend/tailwind.config.ts`
- Create: `apps/frontend/postcss.config.js`
- Create: `apps/frontend/src/app/globals.css`
- Create: `apps/frontend/src/app/layout.tsx`
- Create: `apps/frontend/src/app/page.tsx`

- [ ] **Step 1: Create `apps/frontend/package.json`**

```json
{
  "name": "@wedding/frontend",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "next build",
    "dev": "next dev",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "next lint"
  },
  "dependencies": {
    "@wedding/shared": "workspace:*",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "lucide-react": "^0.400.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `apps/frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/frontend/next.config.ts`**

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [],
  },
}

export default nextConfig
```

- [ ] **Step 4: Create `apps/frontend/postcss.config.js`**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 5: Create `apps/frontend/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'surface-base': 'var(--color-surface-base)',
        'surface-card': 'var(--color-surface-card)',
        border: 'var(--color-border)',
        'text-primary': 'var(--color-text-primary)',
        'text-muted': 'var(--color-text-muted)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        success: 'var(--color-success)',
        error: 'var(--color-error)',
      },
      borderRadius: {
        card: 'var(--radius-card)',
        thumb: 'var(--radius-thumb)',
      },
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'sans-serif'],
        display: ['var(--font-playfair)', 'serif'],
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 6: Create `apps/frontend/src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-surface-base:   #FAF7F4;
  --color-surface-card:   #FFFFFF;
  --color-border:         #E8E2DC;
  --color-text-primary:   #2C2C2C;
  --color-text-muted:     #7A746E;
  --color-accent:         #C4956A;
  --color-accent-hover:   #B08050;
  --color-success:        #4A7C59;
  --color-error:          #C0392B;
  --spacing-base:         8px;
  --radius-card:          12px;
  --radius-thumb:         4px;
  --slideshow-bg:         #0F0E0C;
  --slideshow-surface:    #1A1916;
  --slideshow-text:       #F0EBE3;
  --slideshow-accent:     #D4A870;
  --slideshow-crossfade-duration: 800ms;
  --slideshow-crossfade-easing:   ease-in-out;
  --slideshow-display-duration:   8000ms;
  --transition-fast:  150ms ease;
  --transition-base:  250ms ease;
  --transition-slow:  400ms ease;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

body {
  background-color: var(--color-surface-base);
  color: var(--color-text-primary);
}
```

- [ ] **Step 7: Create `apps/frontend/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import { DM_Sans, Playfair_Display } from 'next/font/google'
import './globals.css'

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
})

export const metadata: Metadata = {
  title: 'Wedding Pic Share',
  description: 'Share your wedding moments',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${dmSans.variable} ${playfair.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
```

- [ ] **Step 8: Create `apps/frontend/src/app/page.tsx`**

```tsx
export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="font-display text-4xl text-text-primary">
        Wedding Pic Share
      </h1>
    </main>
  )
}
```

- [ ] **Step 9: Install dependencies and build**

```bash
cd apps/frontend && pnpm install && pnpm build
```

Expected: Build completes without TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add apps/frontend/
git commit -m "feat(frontend): bare next.js app with design tokens and fonts"
```

---

### Task 6: Docker Setup

**Files:**
- Create: `Dockerfile.backend`
- Create: `Dockerfile.frontend`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
dist
.next
.turbo
*.db
*.db-shm
*.db-wal
data/
.env
coverage/
docs/
```

- [ ] **Step 2: Create `Dockerfile.backend`**

```dockerfile
# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/backend/package.json ./apps/backend/
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm --filter @wedding/shared build
RUN pnpm --filter @wedding/db build
RUN pnpm --filter @wedding/backend build

# Stage 3: Runtime
FROM node:20-alpine AS runner
WORKDIR /app
# Install native deps: vips (for Sharp/HEIC) and ffmpeg
RUN apk add --no-cache vips-heif vips-dev fftw-dev build-base python3 ffmpeg wget
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder --chown=appuser:appgroup /app/apps/backend/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/packages/db/prisma ./prisma

USER appuser
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["sh", "-c", "node node_modules/.bin/prisma migrate deploy && node dist/main.js"]
```

- [ ] **Step 3: Create `Dockerfile.frontend`**

```dockerfile
# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/frontend/package.json ./apps/frontend/
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @wedding/shared build
RUN pnpm --filter @wedding/frontend build

# Stage 3: Runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder --chown=appuser:appgroup /app/apps/frontend/public ./public
COPY --from=builder --chown=appuser:appgroup /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/apps/frontend/.next/static ./.next/static

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
```

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
version: '3.9'

services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=${DATABASE_URL:-file:/app/data/db.sqlite}
      - FRONTEND_URL=${FRONTEND_URL:-http://localhost:3000}
      - STORAGE_PROVIDER=${STORAGE_PROVIDER:-local}
      - STORAGE_LOCAL_PATH=/app/data/uploads
      - MAX_FILE_SIZE_MB=${MAX_FILE_SIZE_MB:-50}
      - MAX_VIDEO_SIZE_MB=${MAX_VIDEO_SIZE_MB:-200}
      - SESSION_SECRET=${SESSION_SECRET:?SESSION_SECRET is required}
      - ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}
      - NODE_ENV=production
    volumes:
      - ./data/uploads:/app/data/uploads
      - ./data/db.sqlite:/app/data/db.sqlite
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://backend:4000}
      - NODE_ENV=production
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
```

- [ ] **Step 5: Create `.env.example`**

```bash
# ─── Database ───────────────────────────────────────────────────────────────
# SQLite (default, zero-config):
DATABASE_URL=file:./data/db.sqlite

# PostgreSQL (optional):
# DATABASE_URL=postgresql://user:pass@localhost:5432/wedding?connection_limit=10&pool_timeout=20

# ─── Authentication ──────────────────────────────────────────────────────────
# Required: random 32+ character secret for session signing
SESSION_SECRET=change-me-to-a-random-32-character-string

# Initial admin credentials (used only during first startup seeding)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me-to-a-strong-password

# ─── Frontend ────────────────────────────────────────────────────────────────
# Backend API URL (used by frontend, must be reachable from browser)
NEXT_PUBLIC_API_URL=http://localhost:4000

# CORS origin for backend (must match frontend URL)
FRONTEND_URL=http://localhost:3000

# ─── Storage ─────────────────────────────────────────────────────────────────
# local (default) or s3
STORAGE_PROVIDER=local
STORAGE_LOCAL_PATH=./data/uploads

# S3-compatible (only if STORAGE_PROVIDER=s3):
# S3_ENDPOINT=https://s3.example.com
# S3_BUCKET=wedding-pics
# S3_REGION=eu-central-1
# S3_ACCESS_KEY_ID=your-access-key
# S3_SECRET_ACCESS_KEY=your-secret-key

# ─── Upload Limits ───────────────────────────────────────────────────────────
MAX_FILE_SIZE_MB=50
MAX_VIDEO_SIZE_MB=200

# ─── Slideshow ───────────────────────────────────────────────────────────────
SLIDESHOW_INTERVAL_SECONDS=8

# ─── SMTP (optional, disable by leaving empty) ───────────────────────────────
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=noreply@example.com
# SMTP_PASS=your-smtp-password
# SMTP_FROM=noreply@example.com
# ADMIN_EMAIL=admin@example.com
```

- [ ] **Step 6: Commit**

```bash
git add Dockerfile.backend Dockerfile.frontend docker-compose.yml .dockerignore .env.example
git commit -m "feat(docker): multi-stage alpine images + compose setup"
```

---

### Task 7: CI Pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    name: Lint, Typecheck, Test
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Generate Prisma client
        run: pnpm --filter @wedding/db run db:generate

      - name: Build shared packages
        run: |
          pnpm --filter @wedding/shared build
          pnpm --filter @wedding/db build

      - name: Typecheck all packages
        run: pnpm typecheck

      - name: Run tests
        run: pnpm test
        env:
          DATABASE_URL: file::memory:?cache=shared

  docker-build:
    name: Docker Build Check
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Build backend image
        run: docker build -f Dockerfile.backend -t wedding-backend:test .

      - name: Build frontend image
        run: docker build -f Dockerfile.frontend -t wedding-frontend:test .
```

- [ ] **Step 2: Commit**

```bash
git add .github/
git commit -m "ci: add github actions workflow for lint, test, docker build"
```

---

### Task 8: Wire Everything Together and Smoke Test

- [ ] **Step 1: Install all workspace dependencies from root**

```bash
cd /path/to/wedding-pic-share && pnpm install
```

Expected: All workspace packages linked.

- [ ] **Step 2: Run full build via Turborepo**

```bash
pnpm build
```

Expected: Builds in order — shared → db → backend (TypeScript compile). Frontend builds last.

- [ ] **Step 3: Run all tests**

```bash
DATABASE_URL="file::memory:?cache=shared" pnpm test
```

Expected: All tests pass across packages.

- [ ] **Step 4: Start backend locally and verify health**

```bash
DATABASE_URL="file:./dev.db" FRONTEND_URL="http://localhost:3000" SESSION_SECRET="dev-secret-32-chars-xxxxxxxxxx" node apps/backend/dist/main.js &
sleep 2
curl http://localhost:4000/health
```

Expected:
```json
{"status":"ok","db":"ok","uptime":2}
```

- [ ] **Step 5: Kill dev server**

```bash
pkill -f "node apps/backend/dist/main.js"
```

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "chore: wire foundation — smoke tests pass, turborepo build green"
```
