import { getClient } from '@wedding/db'
import { computeUploadWindowsVersion } from '../../src/services/uploadWindows.js'

export async function getGalleryUploadWindowsVersion(galleryId: string): Promise<string> {
  const db = getClient()
  const windows = await db.uploadWindow.findMany({
    where: { galleryId },
    select: {
      id: true,
      start: true,
      end: true,
      createdAt: true,
    },
  })
  return computeUploadWindowsVersion(windows)
}
