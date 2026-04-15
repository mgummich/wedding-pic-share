import { normalizeAdminLocale } from './adminI18n'

export function resolveHtmlLang(localeValue: string | null | undefined): string {
  return normalizeAdminLocale(localeValue)
}
