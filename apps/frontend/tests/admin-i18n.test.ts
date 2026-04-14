import { describe, it, expect } from 'vitest'
import {
  adminMessages,
  resolveAdminLocaleFromCookie,
  type AdminLocale,
} from '../src/lib/adminI18n'

describe('admin i18n', () => {
  it('resolves locale from NEXT_LOCALE cookie with fallback to de', () => {
    expect(resolveAdminLocaleFromCookie('foo=bar; NEXT_LOCALE=en; x=y')).toBe('en')
    expect(resolveAdminLocaleFromCookie('NEXT_LOCALE=de')).toBe('de')
    expect(resolveAdminLocaleFromCookie('NEXT_LOCALE=fr')).toBe('de')
    expect(resolveAdminLocaleFromCookie('foo=bar')).toBe('de')
  })

  it('has identical translation keys in de and en', () => {
    const locales: AdminLocale[] = ['de', 'en']
    const keysByLocale = locales.map((locale) => Object.keys(adminMessages[locale]).sort())

    expect(keysByLocale[0]).toEqual(keysByLocale[1])
  })
})
