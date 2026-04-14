import archiver from 'archiver'
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
  existingArchive?: {
    archivePath: string | null
    archiveSizeBytes: number | null
  }
}): Promise<{ archivePath: string; archiveSizeBytes: number }> {
  if (params.existingArchive?.archivePath && params.existingArchive.archiveSizeBytes !== null) {
    return {
      archivePath: params.existingArchive.archivePath,
      archiveSizeBytes: params.existingArchive.archiveSizeBytes,
    }
  }

  const archivePath = archiveRelativePathForGallery(params.galleryId)
  const output = await params.storage.openWriteStream(params.gallerySlug, archivePath)
  const archive = archiver('zip', { zlib: { level: 6 } })

  const finished = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
  })

  archive.pipe(output)

  for (const photo of params.photos) {
    const ext = photo.originalPath.split('.').pop() ?? 'jpg'
    const stream = params.storage.openReadStream(params.gallerySlug, photo.originalPath)
    archive.append(stream, { name: `${photo.id}.${ext}` })
  }

  await archive.finalize()
  await finished

  const fileInfo = await params.storage.stat(params.gallerySlug, archivePath)

  return {
    archivePath,
    archiveSizeBytes: fileInfo.size,
  }
}
