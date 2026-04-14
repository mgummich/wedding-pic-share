export const MAX_IMAGE_FILE_SIZE_MB = 50
export const MAX_VIDEO_FILE_SIZE_MB = 200
export const ALLOWED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'video/mp4',
  'video/quicktime',
]

export const UPLOAD_ERROR_MESSAGES: Record<number, string> = {
  409: 'Dieses Foto wurde bereits hochgeladen.',
  415: 'Dieser Dateityp wird nicht unterstützt. Erlaubt: JPEG, PNG, WEBP, HEIC, MP4, MOV.',
  413: `Diese Datei ist zu groß. Maximal erlaubt: ${MAX_IMAGE_FILE_SIZE_MB} MB.`,
  404: 'Diese Galerie existiert nicht oder wurde deaktiviert.',
}

export function validateUploadFile(file: File): string | null {
  if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
    return UPLOAD_ERROR_MESSAGES[415]
  }

  const limitMb = file.type.startsWith('video/')
    ? MAX_VIDEO_FILE_SIZE_MB
    : MAX_IMAGE_FILE_SIZE_MB

  if (file.size > limitMb * 1024 * 1024) {
    return UPLOAD_ERROR_MESSAGES[413]
  }

  return null
}
