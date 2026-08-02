import React from 'react'
import { useLiveStore } from '../stores/liveStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { RadioLogo } from '../ui/RadioLogo.tsx'
import { useT } from '../i18n/index.ts'

// V2.3 — Mini-player da emissora "no ar": mostra quem está transmitindo
// (sala "Ao vivo") com equalizer animado enquanto houver broadcast.
export function MiniPlayer() {
  const connected = useConnectionStore((s) => s.connected)
  const broadcaster = useLiveStore((s) => s.broadcaster)
  const speaking = useVoiceStore((s) => s.speaking)
  const t = useT()

  if (!connected || !broadcaster) return null

  const active = !!speaking[broadcaster.userId]

  return (
    <div className={`mini-player${active ? ' mini-player--active' : ''}`} role="status" aria-live="polite">
      <RadioLogo size={34} className="mini-player-logo" />
      <div className="mini-player-info">
        <span className="mini-player-label">{t('onAir')}</span>
        <span className="mini-player-name" title={broadcaster.userName}>
          {broadcaster.userName}
        </span>
      </div>
      <div className="mini-player-eq" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
    </div>
  )
}
