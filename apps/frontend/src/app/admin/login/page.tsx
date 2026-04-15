'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { adminLogin, ApiError } from '@/lib/api'
import { useAdminI18n } from '@/components/AdminLocaleContext'
import { useToast } from '@/components/ToastProvider'
import type { AdminLocale } from '@/lib/adminI18n'

export default function AdminLoginPage() {
  const router = useRouter()
  const { locale, setLocale, t } = useAdminI18n()
  const { showToast } = useToast()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [totpRequired, setTotpRequired] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await adminLogin(username, password, totpRequired ? totpCode : undefined)
      router.replace('/admin')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const type = (err.body as { type?: unknown })?.type
        if (type === 'totp-required') {
          setTotpRequired(true)
          const message = t('login.error.totpRequired')
          setError(message)
          showToast(message, 'error')
        } else if (type === 'invalid-totp') {
          setTotpRequired(true)
          const message = t('login.error.invalidTotp')
          setError(message)
          showToast(message, 'error')
        } else {
          const message = t('login.error.invalidCredentials')
          setError(message)
          showToast(message, 'error')
        }
      } else if (err instanceof ApiError && err.status === 429) {
        const message = t('login.error.rateLimited')
        setError(message)
        showToast(message, 'error')
      } else {
        const message = t('login.error.generic')
        setError(message)
        showToast(message, 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-surface-base flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
          <label htmlFor="admin-login-locale" className="sr-only">{t('common.language')}</label>
          <select
            id="admin-login-locale"
            aria-label={t('common.language')}
            value={locale}
            onChange={(event) => setLocale(event.target.value as AdminLocale)}
            className="rounded-card border border-ui-border bg-surface-card px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="de">{t('common.language.de')}</option>
            <option value="en">{t('common.language.en')}</option>
            <option value="es">{t('common.language.es')}</option>
            <option value="fr">{t('common.language.fr')}</option>
          </select>
        </div>
        <h1 className="font-display text-3xl text-text-primary text-center mb-8">
          {t('login.title')}
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-text-primary mb-1">
              {t('login.username')}
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-card border border-ui-border
                         focus:outline-none focus:border-accent bg-surface-card text-text-primary"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-text-primary mb-1">
              {t('login.password')}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 pr-11 rounded-card border border-ui-border
                           focus:outline-none focus:border-accent bg-surface-card text-text-primary"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {totpRequired && (
            <div>
              <label htmlFor="totpCode" className="block text-sm font-medium text-text-primary mb-1">
                {t('login.totpCode')}
              </label>
              <input
                id="totpCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-card border border-ui-border
                         focus:outline-none focus:border-accent bg-surface-card text-text-primary"
              />
            </div>
          )}
          {error && <p className="text-sm text-error">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-white
                       font-medium transition-colors disabled:opacity-50"
          >
            {loading ? t('login.submitting') : t('login.submit')}
          </button>
        </form>
      </div>
    </main>
  )
}
