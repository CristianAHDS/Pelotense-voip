import React from 'react'
import { useAccountStore } from '../stores/accountStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { useT } from '../i18n/index.ts'
import { PrivateChatPanel } from './PrivateChatPanel.tsx'

export function FullscreenDm() {
  const t = useT()
  const open = useAccountStore((s) => s.dmFullscreen)
  const toggle = useAccountStore((s) => s.toggleDmFullscreen)
  const activeUserName = usePrivateChatStore((s) => s.activeUserName)

  if (!open || !activeUserName) return null

  return (
    <div className="modal-overlay modal-overlay--chat" onClick={() => toggle()}>
      <div
        className="fullscreen-chat"
        role="dialog"
        aria-modal="true"
        aria-label={t('chatFullscreen')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fullscreen-chat-toolbar">
          <span className="fullscreen-chat-title">@{activeUserName}</span>
          <button
            className="btn-close-pchat"
            onClick={() => toggle()}
            title={t('closeFullscreen')}
            aria-label={t('closeFullscreen')}
          >
            &times;
          </button>
        </div>
        <div className="fullscreen-chat-body">
          <PrivateChatPanel />
        </div>
      </div>
    </div>
  )
}
