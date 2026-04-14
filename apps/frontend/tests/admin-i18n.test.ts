import { describe, it, expect } from 'vitest'
import {
  adminMessages,
  translateAdminMessage,
  resolveAdminLocaleFromCookie,
} from '../src/lib/adminI18n'

describe('admin i18n', () => {
  it('resolves locale from NEXT_LOCALE cookie with fallback to de', () => {
    expect(resolveAdminLocaleFromCookie('foo=bar; NEXT_LOCALE=en; x=y')).toBe('en')
    expect(resolveAdminLocaleFromCookie('NEXT_LOCALE=de')).toBe('de')
    expect(resolveAdminLocaleFromCookie('NEXT_LOCALE=es')).toBe('es')
    expect(resolveAdminLocaleFromCookie('NEXT_LOCALE=fr')).toBe('fr')
    expect(resolveAdminLocaleFromCookie('foo=bar')).toBe('de')
  })

  it('has identical translation keys in de and en', () => {
    const locales = ['de', 'en'] as const
    const keysByLocale = locales.map((locale) => Object.keys(adminMessages[locale]).sort())

    expect(keysByLocale[0]).toEqual(keysByLocale[1])
  })

  it('supports es and fr locales with fallback-safe translations', () => {
    expect(translateAdminMessage('es', 'common.language')).toBe('Idioma')
    expect(translateAdminMessage('fr', 'common.language')).toBe('Langue')
    expect(translateAdminMessage('es', 'login.submit')).toBeTruthy()
    expect(translateAdminMessage('fr', 'login.submit')).toBeTruthy()
  })
})
