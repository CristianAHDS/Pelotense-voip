import React, { useEffect, useRef, useState } from 'react'
import { useAnnouncementStore } from '../stores/announcementStore.ts'
import { useT } from '../i18n/index.ts'

// Banner global do admin (A14): aparece na tela de todos com barra de
// contagem regressiva; some ao chegar em zero ou ao clicar no X.
export function GlobalAnnouncement() {
  const current = useAnnouncementStore((s) => s.current)
  const dismiss = useAnnouncementStore((s) => s.dismiss)
  const [progress, setProgress] = useState(1)
  const [leaving, setLeaving] = useState(false)
  const rafRef = useRef(0)
  const t = useT()

  useEffect(() => {
    if (!current) {
      setProgress(1)
      setLeaving(false)
      return
    }
    setLeaving(false)
    let start = performance.now()
    const total = current.expiresAt - Date.now()

    const tick = (now: number) => {
      const elapsed = now - start
      const remaining = Math.max(0, total - elapsed)
      setProgress(remaining / total)
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setLeaving(true)
        setTimeout(() => {
          useAnnouncementStore.getState().dismiss()
          setProgress(1)
        }, 350)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [current])

  if (!current) return null

  return (
    <div className={`global-announcement${leaving ? ' global-announcement--leaving' : ''}`} role="status" aria-live="polite">
      <span className="global-announcement-icon" aria-hidden="true">📢</span>
      <span className="global-announcement-text">{current.text}</span>
      <button
        className="global-announcement-close"
        onClick={() => {
          setLeaving(true)
          setTimeout(() => {
            useAnnouncementStore.getState().dismiss()
            setProgress(1)
          }, 350)
        }}
        aria-label={t('close')}
        title={t('close')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <span className="global-announcement-timer" aria-hidden="true">
        <span className="global-announcement-timer-fill" style={{ transform: `scaleX(${progress})` }} />
      </span>
    </div>
  )
}
