'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  ApiError,
  getAdminGalleries,
  getAdminTwoFactorStatus,
  setupAdminTwoFactor,
  verifyAdminTwoFactor,
} from '@/lib/api'
import { Settings, Eye, EyeOff } from 'lucide-react'
import { useAdminI18n } from '@/components/AdminLocaleContext'
import type { AdminMessageKey } from '@/lib/adminI18n'

type Translate = (key: AdminMessageKey, params?: Record<string, string | number>) => string

export default function AdminDashboardPage() {
  const router = useRouter()
  const { t } = useAdminI18n()
  const [galleries, setGalleries] = useState<Awaited<ReturnType<typeof getAdminGalleries>>>([])
  const [loading, setLoading] = useState(true)
  const [twoFactor, setTwoFactor] = useState<{ enabled: boolean; configured: boolean } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const sortedGalleries = useMemo(() => [...galleries].sort((a, b) => {
    if (a.isActive === b.isActive) return a.name.localeCompare(b.name)
    return a.isActive ? -1 : 1
  }), [galleries])

  useEffect(() => {
    Promise.all([
      getAdminGalleries(),
      getAdminTwoFactorStatus(),
    ])
      .then(([loadedGalleries, twoFactorStatus]) => {
        setGalleries(loadedGalleries)
        setTwoFactor(twoFactorStatus)
        setLoadError(null)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login')
        else setLoadError(t('dashboard.loadError'))
      })
      .finally(() => setLoading(false))
  }, [router, t])

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-ui-border">
        <div>
          <h1 className="font-display text-2xl text-text-primary">{t('dashboard.title')}</h1>
          <p className="text-xs text-text-muted mt-1">
            {t('dashboard.singleGalleryHint')}
          </p>
        </div>
      </header>

      <div className="px-4 py-4 space-y-3">
        {loadError && (
          <div className="rounded-card border border-error/40 bg-error/5 px-3 py-2">
            <p className="text-sm text-error">{loadError}</p>
          </div>
        )}

        {!loading && twoFactor?.enabled && (
          <TwoFactorSetupPanel
            configured={twoFactor.configured}
            onConfigured={() => setTwoFactor((current) => current ? { ...current, configured: true } : current)}
            t={t}
          />
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-card border border-ui-border bg-surface-card p-4 animate-pulse">
                <div className="h-4 w-44 rounded-card bg-ui-border" />
                <div className="mt-2 h-3 w-28 rounded-card bg-ui-border" />
                <div className="mt-3 h-3 w-20 rounded-card bg-ui-border" />
              </div>
            ))}
          </div>
        )}

        {!loading && galleries.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-text-muted mb-4">{t('dashboard.empty')}</p>
            <Link
              href="/admin/galleries/new"
              className="px-5 py-2.5 rounded-full bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              {t('dashboard.createFirst')}
            </Link>
          </div>
        )}

        {sortedGalleries.map((gallery) => (
          <div
            key={gallery.id}
            className="bg-surface-card border border-ui-border rounded-card p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-medium text-text-primary">{gallery.name}</h2>
                  {gallery.isActive && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                      {t('dashboard.rootActive')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-muted mt-0.5">
                  {t('dashboard.photos', { count: gallery.photoCount })}
                </p>
                <p className="text-xs text-text-muted mt-0.5 font-mono">/g/{gallery.slug}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/galleries/${gallery.id}/moderate`}
                  className="text-xs px-3 py-1.5 rounded-full bg-surface-base border border-ui-border text-text-muted hover:border-accent hover:text-accent transition-colors"
                >
                  {t('dashboard.moderate')}
                </Link>
                <Link
                  href={`/admin/galleries/${gallery.id}`}
                  aria-label={t('dashboard.settingsAria')}
                  className="p-1.5 text-text-muted hover:text-accent transition-colors"
                >
                  <Settings className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}

function TwoFactorSetupPanel({
  configured,
  onConfigured,
  t,
}: {
  configured: boolean
  onConfigured: () => void
  t: Translate
}) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [setupToken, setSetupToken] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [otpAuthUrl, setOtpAuthUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!otpAuthUrl) {
      setQrDataUrl(null)
      return
    }

    let canceled = false
    void import('qrcode')
      .then((qrcode) => qrcode.toDataURL(otpAuthUrl, { width: 192, margin: 1 }))
      .then((dataUrl) => {
        if (!canceled) {
          setQrDataUrl(dataUrl)
        }
      })
      .catch(() => {
        if (!canceled) {
          setQrDataUrl(null)
        }
      })

    return () => {
      canceled = true
    }
  }, [otpAuthUrl])

  async function handleSetup() {
    setError(null)
    setMessage(null)
    setBusy(true)

    try {
      const setup = await setupAdminTwoFactor(password)
      setSetupToken(setup.setupToken)
      setSecret(setup.secret)
      setOtpAuthUrl(setup.otpauthUrl)
      setMessage(t('dashboard.2fa.setupSuccess'))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t('dashboard.2fa.error.invalidPassword'))
      } else {
        setError(t('dashboard.2fa.error.generic'))
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleVerify() {
    if (!setupToken) return

    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      await verifyAdminTwoFactor(code, setupToken)
      onConfigured()
      setMessage(t('dashboard.2fa.verifySuccess'))
      setPassword('')
      setCode('')
      setSetupToken(null)
      setSecret(null)
      setOtpAuthUrl(null)
      setQrDataUrl(null)
      setCopyMessage(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t('dashboard.2fa.error.invalidCode'))
      } else {
        setError(t('dashboard.2fa.error.generic'))
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy(text: string): Promise<void> {
    try {
      if (!navigator.clipboard) {
        throw new Error('clipboard unavailable')
      }
      await navigator.clipboard.writeText(text)
      setCopyMessage(t('dashboard.2fa.copySuccess'))
    } catch {
      setCopyMessage(t('dashboard.2fa.copyFailed'))
    }
  }

  return (
    <section className="bg-surface-card border border-ui-border rounded-card p-4 space-y-3">
      <h2 className="font-medium text-text-primary">{t('dashboard.2fa.title')}</h2>
      {!configured && (
        <ol className="grid grid-cols-2 gap-2" aria-label={t('dashboard.2fa.progressAria')}>
          <li className={[
            'rounded-card border px-3 py-2 text-xs',
            setupToken ? 'border-ui-border text-text-muted' : 'border-accent text-accent',
          ].join(' ')}>
            {t('dashboard.2fa.step1')}
          </li>
          <li className={[
            'rounded-card border px-3 py-2 text-xs',
            setupToken ? 'border-accent text-accent' : 'border-ui-border text-text-muted',
          ].join(' ')}>
            {t('dashboard.2fa.step2')}
          </li>
        </ol>
      )}
      {configured ? (
        <p className="text-sm text-text-muted">{t('dashboard.2fa.enabled')}</p>
      ) : (
        <>
          <p className="text-sm text-text-muted">{t('dashboard.2fa.notConfigured')}</p>
          <div className="space-y-2">
            <p className="text-xs text-text-muted">{t('dashboard.2fa.step1')}</p>
            <label htmlFor="two-factor-password" className="block text-sm font-medium text-text-primary">
              {t('dashboard.2fa.password')}
            </label>
            <div className="relative">
              <input
                id="two-factor-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
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
            <button
              type="button"
              disabled={busy || password.length === 0}
              onClick={handleSetup}
              className="px-4 py-2 rounded-full bg-accent text-white hover:bg-accent-hover
                         disabled:opacity-50 transition-colors"
            >
              {busy ? t('dashboard.2fa.saving') : t('dashboard.2fa.start')}
            </button>
          </div>

          {setupToken && secret && otpAuthUrl && (
            <div className="space-y-2 rounded-card border border-ui-border/70 p-3">
              <p className="text-xs text-text-muted">{t('dashboard.2fa.step2')}</p>
              {qrDataUrl && (
                <Image
                  src={qrDataUrl}
                  alt={t('dashboard.2fa.qrAlt')}
                  width={192}
                  height={192}
                  className="h-48 w-48 rounded-card border border-ui-border bg-white p-2"
                />
              )}
              <p className="text-xs text-text-muted">
                {t('dashboard.2fa.secret')}: <span className="font-mono break-all">{secret}</span>
              </p>
              <button
                type="button"
                onClick={() => handleCopy(secret)}
                className="text-xs px-3 py-1.5 rounded-full bg-surface-base border border-ui-border text-text-muted hover:border-accent hover:text-accent transition-colors"
              >
                {t('dashboard.2fa.copySecret')}
              </button>
              <p className="text-xs text-text-muted break-all">
                {t('dashboard.2fa.otpauth')}: <span className="font-mono">{otpAuthUrl}</span>
              </p>
              <button
                type="button"
                onClick={() => handleCopy(otpAuthUrl)}
                className="text-xs px-3 py-1.5 rounded-full bg-surface-base border border-ui-border text-text-muted hover:border-accent hover:text-accent transition-colors"
              >
                {t('dashboard.2fa.copyOtpAuth')}
              </button>
              {copyMessage && (
                <p className="text-xs text-text-muted">{copyMessage}</p>
              )}
              <label htmlFor="two-factor-code" className="block text-sm font-medium text-text-primary">
                {t('dashboard.2fa.code')}
              </label>
              <input
                id="two-factor-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="w-full px-4 py-2.5 rounded-card border border-ui-border
                           focus:outline-none focus:border-accent bg-surface-card text-text-primary"
              />
              <button
                type="button"
                disabled={busy || code.length === 0}
                onClick={handleVerify}
                className="px-4 py-2 rounded-full bg-accent text-white hover:bg-accent-hover
                           disabled:opacity-50 transition-colors"
              >
                {busy ? t('dashboard.2fa.saving') : t('dashboard.2fa.verify')}
              </button>
            </div>
          )}
        </>
      )}
      {message && <p className="text-xs text-accent">{message}</p>}
      {error && <p className="text-xs text-error">{error}</p>}
    </section>
  )
}
