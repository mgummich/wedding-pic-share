import { describe, expect, it } from 'vitest'
import { resolveHtmlLang } from '../src/lib/htmlLang'

describe('resolveHtmlLang', () => {
  it('returns supported locale values as html lang', () => {
    expect(resolveHtmlLang('de')).toBe('de')
    expect(resolveHtmlLang('en')).toBe('en')
    expect(resolveHtmlLang('es')).toBe('es')
    expect(resolveHtmlLang('fr')).toBe('fr')
  })

  it('falls back to de for unsupported or missing values', () => {
    expect(resolveHtmlLang('pt')).toBe('de')
    expect(resolveHtmlLang('')).toBe('de')
    expect(resolveHtmlLang(undefined)).toBe('de')
  })
})
