'use client'

import { Camera } from 'lucide-react'
import Link from 'next/link'
import { useAdminI18n } from './AdminLocaleContext'

interface UploadButtonProps {
  gallerySlug: string
  isEmpty?: boolean
}

export function UploadButton({ gallerySlug, isEmpty = false }: UploadButtonProps) {
  const { t } = useAdminI18n()

  return (
    <div className="fixed bottom-6 right-6 z-10">
      <Link
        href={`/g/${gallerySlug}/upload`}
        className={`
          flex items-center gap-2 px-5 py-3 rounded-full shadow-lg
          bg-accent hover:bg-accent-hover text-white font-sans font-medium
          transition-colors duration-[--transition-base]
          ${isEmpty ? 'animate-[gentle-pulse_2s_ease-in-out_infinite]' : ''}
        `}
        aria-label={t('guest.uploadButton.aria')}
      >
        <Camera className="w-5 h-5" />
        <span>{t('guest.uploadButton.label')}</span>
      </Link>
    </div>
  )
}
