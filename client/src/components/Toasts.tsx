import React from 'react'
import { useToastStore } from '../stores/toastStore.ts'
import { tStatic } from '../i18n/index.ts'

const ICONS: Record<string, string> = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
}

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role="status">
          <span className="toast-icon">{ICONS[t.kind] ?? ''}</span>
          <span className="toast-message">{t.message}</span>
          <button
            className="toast-close"
            onClick={() => dismiss(t.id)}
            aria-label={tStatic('close')}
          >
            ×
          </button>
          <div className="toast-bar" style={{ animationDuration: `${t.duration ?? 3000}ms` }} />
        </div>
      ))}
    </div>
  )
}
