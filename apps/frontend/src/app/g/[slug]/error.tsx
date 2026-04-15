'use client'

import { useEffect } from 'react'

export default function GuestGalleryError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="min-h-screen bg-surface-base flex items-center justify-center px-4">
      <section className="max-w-md w-full rounded-card border border-ui-border bg-surface-card p-6 text-center space-y-3">
        <h1 className="font-display text-2xl text-text-primary">Galerie konnte nicht geladen werden</h1>
        <p className="text-sm text-text-muted">Bitte versuche es erneut.</p>
        <button
          type="button"
          onClick={reset}
          className="px-4 py-2 rounded-full bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          Erneut versuchen
        </button>
      </section>
    </main>
  )
}
