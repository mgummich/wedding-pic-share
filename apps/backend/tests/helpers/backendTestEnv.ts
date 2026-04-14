import { execSync } from 'node:child_process'
import { copyFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

type BackendTestEnvOptions = {
  adminUsername?: string
  adminPassword?: string
  frontendUrl?: string
  sessionSecret?: string
  extraEnv?: Record<string, string | undefined>
}

export type BackendTestEnv = {
  rootDir: string
  dbPath: string
  storagePath: string
  cleanup: () => Promise<void>
}

let migratedTemplatePromise: Promise<string> | null = null

function packageDbDir() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '../../../../packages/db')
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
}

function extractExecOutput(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const withStreams = error as Error & { stdout?: Buffer; stderr?: Buffer }
  const stdout = withStreams.stdout?.toString('utf8').trim()
  const stderr = withStreams.stderr?.toString('utf8').trim()
  return [error.message, stdout, stderr].filter(Boolean).join('\n')
}

async function ensureMigratedTemplateDb(): Promise<string> {
  if (migratedTemplatePromise) return migratedTemplatePromise

  migratedTemplatePromise = (async () => {
    const templateRoot = await mkdtemp(path.join(tmpdir(), 'wps-backend-template-'))
    const templateDbPath = path.join(templateRoot, 'template.db')
    const env = {
      ...process.env,
      DATABASE_URL: `file:${templateDbPath}`,
      NODE_ENV: 'test',
    }

    try {
      execSync('npx prisma migrate deploy', {
        cwd: packageDbDir(),
        env,
        stdio: 'pipe',
      })
    } catch (error) {
      throw new Error(`Failed to prepare migrated SQLite template database.\n${extractExecOutput(error)}`)
    }

    return templateDbPath
  })()

  return migratedTemplatePromise
}

async function copyTemplateDb(templateDbPath: string, targetDbPath: string): Promise<void> {
  await copyFile(templateDbPath, targetDbPath)

  const templateWalPath = `${templateDbPath}-wal`
  if (existsSync(templateWalPath)) {
    await copyFile(templateWalPath, `${targetDbPath}-wal`)
  }

  const templateShmPath = `${templateDbPath}-shm`
  if (existsSync(templateShmPath)) {
    await copyFile(templateShmPath, `${targetDbPath}-shm`)
  }
}

export async function createBackendTestEnv(
  name: string,
  options: BackendTestEnvOptions = {}
): Promise<BackendTestEnv> {
  const testName = sanitizeName(name)
  const rootDir = await mkdtemp(path.join(tmpdir(), `wps-${testName}-`))
  const dbPath = path.join(rootDir, `${testName}.db`)
  const storagePath = path.join(rootDir, 'storage')

  try {
    await mkdir(storagePath, { recursive: true })
    const templateDbPath = await ensureMigratedTemplateDb()
    await copyTemplateDb(templateDbPath, dbPath)

    process.env.DATABASE_URL = `file:${dbPath}`
    process.env.SESSION_SECRET = options.sessionSecret ?? 'test-secret-32-chars-xxxxxxxxxxxx'
    process.env.ADMIN_USERNAME = options.adminUsername ?? 'admin'
    process.env.ADMIN_PASSWORD = options.adminPassword ?? 'Password123!'
    process.env.FRONTEND_URL = options.frontendUrl ?? 'http://localhost:3000'
    process.env.STORAGE_LOCAL_PATH = storagePath
    process.env.NODE_ENV = 'test'

    for (const [key, value] of Object.entries(options.extraEnv ?? {})) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  } catch (error) {
    await rm(rootDir, { recursive: true, force: true }).catch(() => {})
    throw new Error(`[backend test setup:${testName}] ${extractExecOutput(error)}`)
  }

  return {
    rootDir,
    dbPath,
    storagePath,
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true })
    },
  }
}
