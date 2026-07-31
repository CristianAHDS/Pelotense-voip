import React, { useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { getVoiceManager } from '../services/connectionService.ts'

function matchesKey(event: KeyboardEvent, key: string): boolean {
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
    return false
  }
  const normalized = key.trim().toLowerCase()
  if (normalized === 'space') {
    return event.code === 'Space' || event.key === ' '
  }
  return event.key.toLowerCase() === normalized || event.code.toLowerCase() === `key${normalized}`
}

export function PushToTalkButton() {
  const pushToTalk = useSettingsStore((s) => s.pushToTalk)
  const pushToTalkKey = useSettingsStore((s) => s.pushToTalkKey)
  const transmitting = useVoiceStore((s) => s.transmitting)
  const setTransmitting = useVoiceStore((s) => s.setTransmitting)

  useEffect(() => {
    if (!pushToTalk) return

    const press = (): void => {
      void getVoiceManager()?.startMicrophone()
      setTransmitting(true)
    }
    const release = (): void => {
      setTransmitting(false)
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (matchesKey(e, pushToTalkKey)) {
        e.preventDefault()
        press()
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (matchesKey(e, pushToTalkKey)) {
        release()
      }
    }
    const onBlur = (): void => release()
    const onVisibility = (): void => {
      if (document.hidden) release()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [pushToTalk, pushToTalkKey, setTransmitting])

  if (!pushToTalk) return null

  return (
    <div className="ptt-overlay" data-testid="ptt-overlay">
      <button
        type="button"
        className={`ptt-btn ${transmitting ? 'ptt-btn--active' : ''}`}
        aria-pressed={transmitting}
        aria-label="Push-to-talk"
        onPointerDown={(e) => {
          e.preventDefault()
          void getVoiceManager()?.startMicrophone()
          setTransmitting(true)
        }}
        onPointerUp={() => setTransmitting(false)}
        onPointerLeave={() => setTransmitting(false)}
        onPointerCancel={() => setTransmitting(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="ptt-btn-label">{transmitting ? 'Falando…' : 'Segurar para falar'}</span>
        {!transmitting && <span className="ptt-btn-key">[{pushToTalkKey}]</span>}
      </button>
    </div>
  )
}
