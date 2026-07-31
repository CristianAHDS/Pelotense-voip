import React, { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/index.ts'
import { radioPlayer, RadioState, RADIO_STREAM_URL } from '../services/radioStream.ts'

export { RADIO_STREAM_URL }

export function RadioBot({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const [state, setState] = useState<RadioState>('idle')
  const unlockRef = useRef<(() => void) | null>(null)

  function armUnlock() {
    if (unlockRef.current) return
    const onGesture = () => {
      disarmUnlock()
      startRadio()
    }
    unlockRef.current = onGesture
    window.addEventListener('pointerdown', onGesture, { passive: true })
    window.addEventListener('touchstart', onGesture, { passive: true })
    window.addEventListener('keydown', onGesture, { passive: true })
  }

  function disarmUnlock() {
    if (!unlockRef.current) return
    window.removeEventListener('pointerdown', unlockRef.current)
    window.removeEventListener('touchstart', unlockRef.current)
    window.removeEventListener('keydown', unlockRef.current)
    unlockRef.current = null
  }

  async function startRadio() {
    try {
      await radioPlayer.play()
    } catch {
      // Autoplay bloqueado: toca na primeira interação do usuário
      armUnlock()
    }
  }

  useEffect(() => {
    const unsubscribe = radioPlayer.onStateChange((s) => setState(s))
    return () => {
      disarmUnlock()
      if (!compact) radioPlayer.stop()
      else unsubscribe()
    }
  }, [])

  function togglePlay() {
    if (state === 'playing') {
      radioPlayer.pause()
    } else {
      startRadio()
    }
  }

  function retry() {
    startRadio()
  }

  const playing = state === 'playing'

  return (
    <div className={`radio-bot${compact ? ' radio-bot--compact' : ''}`}>
      <div className="radio-bot-info">
        <span className={`radio-bot-indicator${playing ? ' on' : ''}`} aria-hidden="true" />
        <span className="radio-bot-name">{t('radioBot')}</span>
        <span className="radio-bot-status">
          {state === 'error' ? t('radioBotError') : playing ? t('radioBotStatus') : t('radioBotPaused')}
        </span>
      </div>
      <button
        className={`radio-bot-btn${playing ? ' playing' : ''}`}
        onClick={togglePlay}
        aria-label={playing ? t('audioPause') : t('audioPlay')}
        title={playing ? t('audioPause') : t('audioPlay')}
      >
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      {state === 'error' && (
        <button className="radio-bot-retry" onClick={retry}>
          {t('radioBotRetry')}
        </button>
      )}
    </div>
  )
}
