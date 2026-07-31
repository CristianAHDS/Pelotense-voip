import React from 'react'
import { useAccountStore } from '../stores/accountStore.ts'
import { useT } from '../i18n/index.ts'
import { ChatPanel } from './ChatPanel.tsx'

export function FullscreenChat() {
  const t = useT()
  const open = useAccountStore((s) => s.chatFullscreen)
  const toggleFullscreen = useAccountStore((s) => s.toggleFullscreen)

  if (!open) return null

  return (
    <div className="modal-overlay modal-overlay--chat" onClick={() => toggleFullscreen()}>
      <div
        className="fullscreen-chat"
        role="dialog"
        aria-modal="true"
        aria-label={t('chatFullscreen')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fullscreen-chat-toolbar">
          <span className="fullscreen-chat-title">{t('chatFullscreen')}</span>
          <button
            className="btn-close-pchat"
            onClick={() => toggleFullscreen()}
            title={t('closeFullscreen')}
            aria-label={t('closeFullscreen')}
          >
            &times;
          </button>
        </div>
        <div className="fullscreen-chat-body">
          <ChatPanel />
        </div>
      </div>
    </div>
  )
}
