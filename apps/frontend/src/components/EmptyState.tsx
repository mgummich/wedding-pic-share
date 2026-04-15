import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="w-16 h-16 mb-6 rounded-full bg-ui-border flex items-center justify-center">
        <span className="text-3xl" aria-hidden="true">📷</span>
      </div>
      <h2 className="font-display text-2xl text-text-primary mb-2">{title}</h2>
      {description && (
        <p className="text-text-muted text-base mb-6 max-w-sm">{description}</p>
      )}
      {action}
    </div>
  )
}
