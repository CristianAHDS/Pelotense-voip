import React from 'react'
import { RadioLogo } from '../ui/RadioLogo.tsx'
import { useRoomStore } from '../stores/roomStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRooms } from '../hooks/useRooms.ts'
import { useT } from '../i18n/index.ts'

// Estado de boas-vindas: mostra a identidade da rádio (discreta) e atalhos
// para entrar numa sala quando nada está selecionado, para a tela não ficar vazia.
export function WelcomePanel() {
  const connected = useConnectionStore((s) => s.connected)
  const currentRoom = useRoomStore((s) => s.currentRoom)
  const rooms = useRoomStore((s) => s.rooms)
  const { join } = useRooms()
  const t = useT()

  if (!connected || currentRoom) return null

  return (
    <div className="welcome-panel">
      <RadioLogo size={64} className="welcome-logo" />
      <h2 className="welcome-title">
        Rádio Pelotense <span>99.5&nbsp;FM</span>
      </h2>
      <p className="welcome-hint">{t('welcomeHint')}</p>
      {rooms.length > 0 && (
        <div className="welcome-rooms">
          <span className="welcome-rooms-label">{t('quickJoin')}</span>
          <div className="welcome-room-chips">
            {rooms.slice(0, 8).map((r) => (
              <button
                key={r.id}
                className={`welcome-chip${r.live ? ' welcome-chip--live' : ''}`}
                onClick={() => join(r.name)}
                title={r.live ? t('isLiveTooltip', { name: r.live?.userName ?? '' }) : undefined}
              >
                <span className="welcome-chip-name">#{r.name}</span>
                {r.live && <span className="welcome-chip-live">{t('liveBadge')}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
