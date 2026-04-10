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
    expect(url).toContain('/api/v1/files/')
  })

  it('deletes a file', async () => {
    await storage.save('test-gallery', 'to-delete.txt', Buffer.from('bye'))
    await storage.delete('test-gallery', 'to-delete.txt')
    await expect(storage.get('test-gallery', 'to-delete.txt')).rejects.toThrow()
  })

  it('throws when s3 provider requested', () => {
    expect(() => createStorage({ provider: 's3', localPath: '/tmp' })).toThrow('S3 storage not yet implemented')
  })
})
