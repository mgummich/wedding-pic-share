'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'

type ToastTone = 'success' | 'error' | 'info'

type Toast = {
  id: string
  message: string
  tone: ToastTone
}

type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
})

const TOAST_DURATION_MS = 5000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => removeToast(id), TOAST_DURATION_MS)
  }, [removeToast])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 z-[120] flex w-full max-w-sm flex-col gap-2"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={[
              'pointer-events-auto rounded-card border px-3 py-2 shadow-lg',
              toast.tone === 'success' && 'border-success/40 bg-success/10 text-text-primary',
              toast.tone === 'error' && 'border-error/40 bg-error/10 text-text-primary',
              toast.tone === 'info' && 'border-ui-border bg-surface-card text-text-primary',
            ].filter(Boolean).join(' ')}
            role="status"
          >
            <div className="flex items-start gap-2">
              {toast.tone === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" aria-hidden="true" />}
              {toast.tone === 'error' && <AlertCircle className="mt-0.5 h-4 w-4 text-error" aria-hidden="true" />}
              {toast.tone === 'info' && <AlertCircle className="mt-0.5 h-4 w-4 text-accent" aria-hidden="true" />}
              <p className="min-w-0 flex-1 text-sm">{toast.message}</p>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="rounded p-0.5 text-text-muted hover:text-text-primary"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}
