'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  resolveAdminLocaleFromCookie,
  translateAdminMessage,
  type AdminLocale,
  type AdminMessageKey,
} from '@/lib/adminI18n'

type AdminLocaleContextValue = {
  locale: AdminLocale
  setLocale: (locale: AdminLocale) => void
  t: (key: AdminMessageKey, params?: Record<string, string | number>) => string
}

const AdminLocaleContext = createContext<AdminLocaleContextValue | null>(null)

function persistLocaleCookie(locale: AdminLocale) {
  document.cookie = `NEXT_LOCALE=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`
}

function createTranslator(locale: AdminLocale) {
  return (key: AdminMessageKey, params: Record<string, string | number> = {}) =>
    translateAdminMessage(locale, key, params)
}

export function AdminLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AdminLocale>(() => {
    if (typeof document === 'undefined') return 'de'
    return resolveAdminLocaleFromCookie(document.cookie)
  })

  const setLocale = useCallback((nextLocale: AdminLocale) => {
    setLocaleState(nextLocale)
    if (typeof document !== 'undefined') {
      persistLocaleCookie(nextLocale)
    }
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
    }
  }, [locale])

  const t = useMemo(() => createTranslator(locale), [locale])

  const value = useMemo<AdminLocaleContextValue>(() => ({
    locale,
    setLocale,
    t,
  }), [locale, setLocale, t])

  return (
    <AdminLocaleContext.Provider value={value}>
      {children}
    </AdminLocaleContext.Provider>
  )
}

export function useAdminI18n(): AdminLocaleContextValue {
  const context = useContext(AdminLocaleContext)
  if (context) return context

  return {
    locale: 'de',
    setLocale: () => {},
    t: createTranslator('de'),
  }
}
