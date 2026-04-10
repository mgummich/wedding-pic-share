import { PrismaClient } from '@prisma/client'

let _client: PrismaClient | null = null

export function getClient(): PrismaClient {
  if (!_client) {
    _client = new PrismaClient()
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
