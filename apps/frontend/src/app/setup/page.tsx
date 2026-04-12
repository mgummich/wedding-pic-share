'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, getSetupStatus, submitSetup } from '@/lib/api'

const MIN_PASSWORD_LENGTH = 12

type Step = 1 | 2

export default function SetupPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [step, setStep] = useState<Step>(1)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [weddingName, setWeddingName] = useState('')
  const [galleryName, setGalleryName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const status = await getSetupStatus()
        if (cancelled) {
          return
        }
        if (!status.setupRequired) {
          router.replace('/admin/login')
          return
        }
        setReady(true)
      } catch {
        if (!cancelled) {
          setError('Ein Fehler ist aufgetreten. Bitte versuche es erneut.')
          setReady(true)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [router])

  function handleStepOneSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError('Das Passwort muss mindestens 12 Zeichen lang sein.')
      return
    }

    setStep(2)
  }

  async function handleSetupSubmission(includeGallery: boolean) {
    setError(null)
    setLoading(true)

    try {
      await submitSetup({
        username: username.trim(),
        password,
        weddingName: includeGallery && weddingName.trim() ? weddingName.trim() : undefined,
        galleryName: includeGallery && galleryName.trim() ? galleryName.trim() : undefined,
      })
      router.replace('/admin/login')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        router.replace('/admin/login')
        return
      }

      setError('Ein Fehler ist aufgetreten. Bitte versuche es erneut.')
      setLoading(false)
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-surface-base flex items-center justify-center px-4">
        <p className="text-sm text-text-muted">Setup wird geladen…</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-surface-base px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-8 text-center">
          <p className="text-sm uppercase tracking-[0.2em] text-text-muted mb-3">Ersteinrichtung</p>
          <h1 className="font-display text-4xl text-text-primary">Wedding Pics Setup</h1>
        </header>

        <div className="rounded-card border border-border bg-surface-card p-6 shadow-soft">
          {step === 1 ? (
            <form onSubmit={handleStepOneSubmit} className="space-y-5">
              <div>
                <p className="text-sm text-text-muted mb-2">Schritt 1 von 2</p>
                <h2 className="font-display text-2xl text-text-primary">Admin-Zugangsdaten</h2>
              </div>

              <div>
                <label htmlFor="username" className="block text-sm font-medium text-text-primary mb-1">
                  Benutzername
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  maxLength={64}
                  autoComplete="username"
                  className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-base text-text-primary"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-text-primary mb-1">
                  Passwort
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={128}
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-base text-text-primary"
                />
                <p className="text-xs text-text-muted mt-1">Mindestens 12 Zeichen</p>
              </div>

              {error && <p className="text-sm text-error">{error}</p>}

              <button
                type="submit"
                className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
              >
                Weiter
              </button>
            </form>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-sm text-text-muted mb-2">Schritt 2 von 2</p>
                <h2 className="font-display text-2xl text-text-primary">Erste Galerie</h2>
                <p className="text-sm text-text-muted mt-2">
                  Optional: Erstelle direkt die erste Hochzeit und Galerie.
                </p>
              </div>

              <div>
                <label htmlFor="wedding-name" className="block text-sm font-medium text-text-primary mb-1">
                  Name der Hochzeit
                </label>
                <input
                  id="wedding-name"
                  type="text"
                  value={weddingName}
                  onChange={(event) => setWeddingName(event.target.value)}
                  maxLength={100}
                  className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-base text-text-primary"
                />
              </div>

              <div>
                <label htmlFor="gallery-name" className="block text-sm font-medium text-text-primary mb-1">
                  Name der Galerie
                </label>
                <input
                  id="gallery-name"
                  type="text"
                  value={galleryName}
                  onChange={(event) => setGalleryName(event.target.value)}
                  maxLength={100}
                  className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-base text-text-primary"
                />
              </div>

              {error && <p className="text-sm text-error">{error}</p>}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void handleSetupSubmission(false)}
                  disabled={loading}
                  className="flex-1 py-3 rounded-full border border-border text-text-primary font-medium hover:border-accent transition-colors disabled:opacity-50"
                >
                  Überspringen
                </button>
                <button
                  type="button"
                  onClick={() => void handleSetupSubmission(true)}
                  disabled={loading}
                  className="flex-1 py-3 rounded-full bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-50"
                >
                  {loading ? 'Wird gespeichert…' : 'Galerie erstellen'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
