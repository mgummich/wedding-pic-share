'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ApiError,
  getAdminGalleries,
  getAdminTwoFactorStatus,
  setupAdminTwoFactor,
  verifyAdminTwoFactor,
} from '@/lib/api'
import { Settings } from 'lucide-react'
import { useAdminI18n } from '@/components/AdminLocaleContext'

export default function AdminDashboardPage() {
  const router = useRouter()
  const { t } = useAdminI18n()
  const [galleries, setGalleries] = useState<Awaited<ReturnType<typeof getAdminGalleries>>>([])
  const [loading, setLoading] = useState(true)
  const [twoFactor, setTwoFactor] = useState<{ enabled: boolean; configured: boolean } | null>(null)
  const [twoFactorPassword, setTwoFactorPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorSetupToken, setTwoFactorSetupToken] = useState<string | null>(null)
  const [twoFactorSecret, setTwoFactorSecret] = useState<string | null>(null)
  const [twoFactorOtpAuthUrl, setTwoFactorOtpAuthUrl] = useState<string | null>(null)
  const [twoFactorBusy, setTwoFactorBusy] = useState(false)
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null)
  const [twoFactorMessage, setTwoFactorMessage] = useState<string | null>(null)
  const [twoFactorQrDataUrl, setTwoFactorQrDataUrl] = useState<string | null>(null)
  const [twoFactorCopyMessage, setTwoFactorCopyMessage] = useState<string | null>(null)
  const sortedGalleries = [...galleries].sort((a, b) => {
    if (a.isActive === b.isActive) return a.name.localeCompare(b.name)
    return a.isActive ? -1 : 1
  })

  useEffect(() => {
    Promise.all([
      getAdminGalleries(),
      getAdminTwoFactorStatus(),
    ])
      .then(([loadedGalleries, twoFactorStatus]) => {
        setGalleries(loadedGalleries)
        setTwoFactor(twoFactorStatus)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login')
      })
      .finally(() => setLoading(false))
  }, [router])

  useEffect(() => {
    if (!twoFactorOtpAuthUrl) {
      setTwoFactorQrDataUrl(null)
      return
    }

    let canceled = false
    void import('qrcode')
      .then((qrcode) => qrcode.toDataURL(twoFactorOtpAuthUrl, { width: 192, margin: 1 }))
      .then((dataUrl) => {
        if (!canceled) {
          setTwoFactorQrDataUrl(dataUrl)
        }
      })
      .catch(() => {
        if (!canceled) {
          setTwoFactorQrDataUrl(null)
        }
      })

    return () => {
      canceled = true
    }
  }, [twoFactorOtpAuthUrl])

  async function handleTwoFactorSetup() {
    setTwoFactorError(null)
    setTwoFactorMessage(null)
    setTwoFactorBusy(true)

    try {
      const setup = await setupAdminTwoFactor(twoFactorPassword)
      setTwoFactorSetupToken(setup.setupToken)
      setTwoFactorSecret(setup.secret)
      setTwoFactorOtpAuthUrl(setup.otpauthUrl)
      setTwoFactorMessage(t('dashboard.2fa.setupSuccess'))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setTwoFactorError(t('dashboard.2fa.error.invalidPassword'))
      } else {
        setTwoFactorError(t('dashboard.2fa.error.generic'))
      }
    } finally {
      setTwoFactorBusy(false)
    }
  }

  async function handleTwoFactorVerify() {
    if (!twoFactorSetupToken) return

    setTwoFactorError(null)
    setTwoFactorMessage(null)
    setTwoFactorBusy(true)
    try {
      await verifyAdminTwoFactor(twoFactorCode, twoFactorSetupToken)
      setTwoFactor((current) => current ? { ...current, configured: true } : current)
      setTwoFactorMessage(t('dashboard.2fa.verifySuccess'))
      setTwoFactorPassword('')
      setTwoFactorCode('')
      setTwoFactorSetupToken(null)
      setTwoFactorSecret(null)
      setTwoFactorOtpAuthUrl(null)
      setTwoFactorQrDataUrl(null)
      setTwoFactorCopyMessage(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setTwoFactorError(t('dashboard.2fa.error.invalidCode'))
      } else {
        setTwoFactorError(t('dashboard.2fa.error.generic'))
      }
    } finally {
      setTwoFactorBusy(false)
    }
  }

  async function handleCopy(text: string): Promise<void> {
    try {
      if (!navigator.clipboard) {
        throw new Error('clipboard unavailable')
      }
      await navigator.clipboard.writeText(text)
      setTwoFactorCopyMessage(t('dashboard.2fa.copySuccess'))
    } catch {
      setTwoFactorCopyMessage(t('dashboard.2fa.copyFailed'))
    }
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-border">
        <div>
          <h1 className="font-display text-2xl text-text-primary">{t('dashboard.title')}</h1>
          <p className="text-xs text-text-muted mt-1">
            {t('dashboard.singleGalleryHint')}
          </p>
        </div>
      </header>

      <div className="px-4 py-4 space-y-3">
        {!loading && twoFactor?.enabled && (
          <section className="bg-surface-card border border-border rounded-card p-4 space-y-3">
            <h2 className="font-medium text-text-primary">{t('dashboard.2fa.title')}</h2>
            {twoFactor.configured ? (
              <p className="text-sm text-text-muted">{t('dashboard.2fa.enabled')}</p>
            ) : (
              <>
                <p className="text-sm text-text-muted">{t('dashboard.2fa.notConfigured')}</p>
                <div className="space-y-2">
                  <p className="text-xs text-text-muted">{t('dashboard.2fa.step1')}</p>
                  <label htmlFor="two-factor-password" className="block text-sm font-medium text-text-primary">
                    {t('dashboard.2fa.password')}
                  </label>
                  <input
                    id="two-factor-password"
                    type="password"
                    autoComplete="current-password"
                    value={twoFactorPassword}
                    onChange={(event) => setTwoFactorPassword(event.target.value)}
                    className="w-full px-4 py-2.5 rounded-card border border-border
                               focus:outline-none focus:border-accent bg-surface-card text-text-primary"
                  />
                  <button
                    type="button"
                    disabled={twoFactorBusy || twoFactorPassword.length === 0}
                    onClick={handleTwoFactorSetup}
                    className="px-4 py-2 rounded-full bg-accent text-white hover:bg-accent-hover
                               disabled:opacity-50 transition-colors"
                  >
                    {twoFactorBusy ? t('dashboard.2fa.saving') : t('dashboard.2fa.start')}
                  </button>
                </div>

                {twoFactorSetupToken && twoFactorSecret && twoFactorOtpAuthUrl && (
                  <div className="space-y-2 rounded-card border border-border/70 p-3">
                    <p className="text-xs text-text-muted">{t('dashboard.2fa.step2')}</p>
                    {twoFactorQrDataUrl && (
                      <img
                        src={twoFactorQrDataUrl}
                        alt={t('dashboard.2fa.qrAlt')}
                        className="h-48 w-48 rounded-card border border-border bg-white p-2"
                      />
                    )}
                    <p className="text-xs text-text-muted">
                      {t('dashboard.2fa.secret')}: <span className="font-mono break-all">{twoFactorSecret}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => handleCopy(twoFactorSecret)}
                      className="text-xs px-3 py-1.5 rounded-full bg-surface-base border border-border text-text-muted hover:border-accent hover:text-accent transition-colors"
                    >
                      {t('dashboard.2fa.copySecret')}
                    </button>
                    <p className="text-xs text-text-muted break-all">
                      {t('dashboard.2fa.otpauth')}: <span className="font-mono">{twoFactorOtpAuthUrl}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => handleCopy(twoFactorOtpAuthUrl)}
                      className="text-xs px-3 py-1.5 rounded-full bg-surface-base border border-border text-text-muted hover:border-accent hover:text-accent transition-colors"
                    >
                      {t('dashboard.2fa.copyOtpAuth')}
                    </button>
                    {twoFactorCopyMessage && (
                      <p className="text-xs text-text-muted">{twoFactorCopyMessage}</p>
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
                      value={twoFactorCode}
                      onChange={(event) => setTwoFactorCode(event.target.value)}
                      className="w-full px-4 py-2.5 rounded-card border border-border
                                 focus:outline-none focus:border-accent bg-surface-card text-text-primary"
                    />
                    <button
                      type="button"
                      disabled={twoFactorBusy || twoFactorCode.length === 0}
                      onClick={handleTwoFactorVerify}
                      className="px-4 py-2 rounded-full bg-accent text-white hover:bg-accent-hover
                                 disabled:opacity-50 transition-colors"
                    >
                      {twoFactorBusy ? t('dashboard.2fa.saving') : t('dashboard.2fa.verify')}
                    </button>
                  </div>
                )}
              </>
            )}
            {twoFactorMessage && <p className="text-xs text-accent">{twoFactorMessage}</p>}
            {twoFactorError && <p className="text-xs text-error">{twoFactorError}</p>}
          </section>
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-card bg-border animate-pulse" />
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
            className="bg-surface-card border border-border rounded-card p-4"
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
                  className="text-xs px-3 py-1.5 rounded-full bg-surface-base border border-border text-text-muted hover:border-accent hover:text-accent transition-colors"
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
