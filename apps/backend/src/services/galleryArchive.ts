import archiver from 'archiver'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { StorageService } from './storage.js'

type ArchivablePhoto = {
  id: string
  originalPath: string
}

export function archiveRelativePathForGallery(galleryId: string): string {
  return `archives/${galleryId}.zip`
}

export async function createGalleryArchive(params: {
  galleryId: string
  gallerySlug: string
  photos: ArchivablePhoto[]
  storage: StorageService
}): Promise<{ archivePath: string; archiveSizeBytes: number }> {
  const archivePath = archiveRelativePathForGallery(params.galleryId)
  const outputPath = params.storage.filePath(params.gallerySlug, archivePath)

  await mkdir(dirname(outputPath), { recursive: true })

  const output = createWriteStream(outputPath)
  const archive = archiver('zip', { zlib: { level: 6 } })

  const finished = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
  })

  archive.pipe(output)

  for (const photo of params.photos) {
    const ext = photo.originalPath.split('.').pop() ?? 'jpg'
    const stream = createReadStream(params.storage.filePath(params.gallerySlug, photo.originalPath))
    archive.append(stream, { name: `${photo.id}.${ext}` })
  }

  await archive.finalize()
  await finished

  const fileInfo = await stat(outputPath)

  return {
    archivePath,
    archiveSizeBytes: fileInfo.size,
  }
}
