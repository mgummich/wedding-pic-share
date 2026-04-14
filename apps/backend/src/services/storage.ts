import { createReadStream, createWriteStream } from 'fs'
import { mkdir, readFile, writeFile, unlink, stat } from 'fs/promises'
import { join, dirname } from 'path'
import type { ReadStream, WriteStream } from 'fs'

export interface StorageService {
  save(gallerySlug: string, filename: string, data: Buffer): Promise<void>
  get(gallerySlug: string, filename: string): Promise<Buffer>
  delete(gallerySlug: string, filename: string): Promise<void>
  publicUrl(gallerySlug: string, filename: string): string
  openReadStream(gallerySlug: string, filename: string): ReadStream
  openWriteStream(gallerySlug: string, filename: string): Promise<WriteStream>
  stat(gallerySlug: string, filename: string): Promise<{ size: number }>
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

    openReadStream(gallerySlug, filename) {
      return createReadStream(filePath(gallerySlug, filename))
    },

    async openWriteStream(gallerySlug, filename) {
      const fp = filePath(gallerySlug, filename)
      await mkdir(dirname(fp), { recursive: true })
      return createWriteStream(fp)
    },

    async stat(gallerySlug, filename) {
      const info = await stat(filePath(gallerySlug, filename))
      return { size: info.size }
    },

    publicUrl(gallerySlug, filename) {
      return `/api/v1/files/${gallerySlug}/${filename}`
    },
  }
}
