import type { AdminLocale } from './adminI18n'

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

const uploadErrorMessages = {
  de: {
    duplicate: 'Dieses Foto wurde bereits hochgeladen.',
    unsupportedType: 'Dieser Dateityp wird nicht unterstützt. Erlaubt: JPEG, PNG, WEBP, HEIC, MP4, MOV.',
    tooLarge: 'Diese Datei ist zu groß. Maximal erlaubt: {maxMb} MB.',
    missingGallery: 'Diese Galerie existiert nicht oder wurde deaktiviert.',
  },
  en: {
    duplicate: 'This photo has already been uploaded.',
    unsupportedType: 'This file type is not supported. Allowed: JPEG, PNG, WEBP, HEIC, MP4, MOV.',
    tooLarge: 'This file is too large. Maximum allowed: {maxMb} MB.',
    missingGallery: 'This gallery does not exist or has been disabled.',
  },
} as const

function withMaxMb(template: string, maxMb: number): string {
  return template.replace('{maxMb}', String(maxMb))
}

export function getUploadErrorMessage(
  status: number,
  locale: AdminLocale,
  options: { maxMb?: number } = {}
): string | undefined {
  const messages = uploadErrorMessages[locale]
  switch (status) {
    case 409:
      return messages.duplicate
    case 415:
      return messages.unsupportedType
    case 413:
      return withMaxMb(messages.tooLarge, options.maxMb ?? MAX_IMAGE_FILE_SIZE_MB)
    case 404:
      return messages.missingGallery
    default:
      return undefined
  }
}

export function validateUploadFile(file: File, locale: AdminLocale): string | null {
  if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
    return getUploadErrorMessage(415, locale) ?? null
  }

  const limitMb = file.type.startsWith('video/')
    ? MAX_VIDEO_FILE_SIZE_MB
    : MAX_IMAGE_FILE_SIZE_MB

  if (file.size > limitMb * 1024 * 1024) {
    return getUploadErrorMessage(413, locale, { maxMb: limitMb }) ?? null
  }

  return null
}
