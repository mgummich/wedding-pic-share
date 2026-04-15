import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/client/index.js'

let _client: PrismaClient | null = null

export function getClient(): PrismaClient {
  if (!_client) {
    const url = process.env.DATABASE_URL ?? 'file:./data/db.sqlite'
    const adapter = new PrismaBetterSqlite3(
      { url },
      // Keep compatibility with existing SQLite data format.
      { timestampFormat: 'unixepoch-ms' }
    )
    _client = new PrismaClient({ adapter })
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
