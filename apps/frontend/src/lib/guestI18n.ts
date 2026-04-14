'use client'

import { useMemo } from 'react'
import {
  resolveAdminLocaleFromCookie,
  translateAdminMessage,
  type AdminLocale,
  type AdminMessageKey,
} from './adminI18n'

type GuestI18n = {
  locale: AdminLocale
  t: (key: AdminMessageKey, params?: Record<string, string | number>) => string
}

export function useGuestI18n(): GuestI18n {
  const locale = useMemo<AdminLocale>(() => {
    if (typeof document === 'undefined') return 'de'
    return resolveAdminLocaleFromCookie(document.cookie)
  }, [])

  const t = useMemo(
    () => (key: AdminMessageKey, params: Record<string, string | number> = {}) =>
      translateAdminMessage(locale, key, params),
    [locale]
  )

  return { locale, t }
}
