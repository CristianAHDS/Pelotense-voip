import React, { useEffect, useState, useRef } from 'react'
import { useRooms } from '../hooks/useRooms.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { useVoiceStore, SPEAKING_TIMEOUT_MS } from '../stores/voiceStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { sendLiveForceStop, requestPrivateHistory } from '../services/connectionService.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { useT } from '../i18n/index.ts'
import { RadioBot } from './RadioBot.tsx'
import { UserInfoPopup, TooltipUser } from './UserInfoPopup.tsx'
import { RADIO_ROOM_NAME } from '../ui/radioBot.ts'
import { isMasterUser, tagColor } from '../ui/admin.ts'

interface PopoverState {
  user: TooltipUser
  left: number
  top: number
}

export function UserList() {
  const connected = useConnectionStore((s) => s.connected)
  const { users } = useRooms()
  const accounts = useRoomStore((s) => s.accounts)
  const currentRoomName = useRoomStore((s) => s.currentRoomName)
  const myId = useConnectionStore((s) => s.id)
  const myAdmin = useConnectionStore((s) => s.admin)
  const openChat = usePrivateChatStore((s) => s.openChat)
  const activeUserId = usePrivateChatStore((s) => s.activeUserId)
  const unread = usePrivateChatStore((s) => s.unread)
  const speaking = useVoiceStore((s) => s.speaking)
  const broadcaster = useLiveStore((s) => s.broadcaster)
  const t = useT()
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const timer = setInterval(() => useVoiceStore.getState().pruneSpeaking(), 200)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (showTimer.current) clearTimeout(showTimer.current)
    }
  }, [])

  if (!connected) return null

  function handleClick(userId: string, userName: string) {
    if (userId === myId) return
    openChat(userId, userName)
    requestPrivateHistory(userId)
  }

  function showPopover(user: TooltipUser, el: HTMLElement) {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    const rect = el.getBoundingClientRect()
    const width = 280
    let left = rect.right + 10
    if (left + width > window.innerWidth - 8) {
      left = rect.left - width - 10
    }
    const top = Math.min(rect.top, Math.max(8, window.innerHeight - 240))
    setPopover({ user, left: Math.max(8, left), top: Math.max(8, top) })
  }

  // Abre a janelinha após 500ms com o mouse parado sobre o item.
  function schedulePopover(user: TooltipUser, el: HTMLElement) {
    if (showTimer.current) clearTimeout(showTimer.current)
    showTimer.current = setTimeout(() => showPopover(user, el), 500)
  }

  function cancelPopover() {
    if (showTimer.current) {
      clearTimeout(showTimer.current)
      showTimer.current = null
    }
  }

  function hidePopover() {
    cancelPopover()
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setPopover(null), 200)
  }

  function clearHide() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }

  const offlineAccounts = accounts.filter((a) => !a.online)

  // Master primeiro, depois admins, depois os demais.
  function byRole<T extends { id?: string; name?: string; email?: string; admin?: boolean }>(a: T, b: T): number {
    const aMaster = isMasterUser(a) ? 1 : 0
    const bMaster = isMasterUser(b) ? 1 : 0
    if (aMaster !== bMaster) return bMaster - aMaster
    const aAdmin = a.admin ? 1 : 0
    const bAdmin = b.admin ? 1 : 0
    return bAdmin - aAdmin
  }

  const sortedOnline = [...users].sort(byRole)
  const sortedOffline = [...offlineAccounts].sort(byRole)

  return (
    <div className="panel user-list">
      <h2>{t('usersWithCount', { count: users.length + offlineAccounts.length })}</h2>
      {currentRoomName === RADIO_ROOM_NAME && <RadioBot compact />}

      <div className="user-list-section">
        <h3 className="user-list-section-title">
          <span className="section-status-dot section-status-dot--online" aria-hidden="true" />
          <span>{t('onlineUsers', { n: users.length })}</span>
        </h3>
        <div className="user-list-items">
          {sortedOnline.map((user) => {
            const isMe = user.id === myId
            const isActive = user.id === activeUserId
            const hasUnread = !isMe && unread[user.id]
            const isSpeaking = !!speaking[user.id] && Date.now() - speaking[user.id] <= SPEAKING_TIMEOUT_MS
            const canStopLive = myAdmin && broadcaster?.userId === user.id && !isMe
            return (
              <div
                key={user.id}
                className={`user-item ${isActive ? 'user-item--active' : ''} ${!isMe ? 'user-item--clickable' : ''} ${isSpeaking ? 'user-item--speaking' : ''}`}
                onClick={() => handleClick(user.id, user.name)}
                role={!isMe ? 'button' : undefined}
                tabIndex={!isMe ? 0 : undefined}
                onKeyDown={(e) => e.key === 'Enter' && handleClick(user.id, user.name)}
                onMouseEnter={(e) => schedulePopover(user, e.currentTarget)}
                onMouseMove={(e) => schedulePopover(user, e.currentTarget)}
                onMouseLeave={hidePopover}
              >
                <Avatar id={user.id} name={user.name} avatar={user.avatar} />
                <span className="user-name">
                  {user.name}{isMe ? ' (you)' : ''}
                  {user.admin ? (
                    <span className={`user-admin-badge ${isMasterUser(user) ? 'user-admin-badge--master' : ''}`} title={isMasterUser(user) ? 'Master Admin' : 'Admin'}>
                      {isMasterUser(user) ? 'Master' : 'Admin'}
                    </span>
                  ) : user.tags?.[0] ? (
                    <span className="user-tag" style={{ background: tagColor(user.tags[0]), borderColor: tagColor(user.tags[0]) }}>{user.tags[0]}</span>
                  ) : null}
                </span>
                {isSpeaking && <span className="user-speaking-dot" title="Speaking" />}
                {canStopLive && (
                  <button
                    className="user-stop-live-btn"
                    title="Stop live broadcast"
                    onClick={(e) => {
                      e.stopPropagation()
                      sendLiveForceStop(user.id)
                    }}
                  >
                    Stop live
                  </button>
                )}
                {hasUnread && <span className="user-unread-dot" />}
              </div>
            )
          })}
        </div>
        {users.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon">👥</span>
            <span className="empty-state-title">{t('noUsers')}</span>
            <span className="empty-state-hint">{t('noUsersHint')}</span>
          </div>
        )}
      </div>

      {offlineAccounts.length > 0 && (
        <div className="user-list-section">
          <h3 className="user-list-section-title">
            <span className="section-status-dot section-status-dot--offline" aria-hidden="true" />
            <span>{t('offlineUsers', { n: offlineAccounts.length })}</span>
          </h3>
          <div className="user-list-items">
            {sortedOffline.map((acc) => (
              <div
                key={acc.id ?? acc.name}
                className={`user-item user-item--offline ${acc.id ? 'user-item--clickable' : ''}`}
                role={acc.id ? 'button' : undefined}
                tabIndex={acc.id ? 0 : undefined}
                onClick={() => acc.id && handleClick(acc.id, acc.name)}
                onKeyDown={(e) => e.key === 'Enter' && acc.id && handleClick(acc.id, acc.name)}
                onMouseEnter={(e) => acc.id && schedulePopover(acc, e.currentTarget)}
                onMouseMove={(e) => acc.id && schedulePopover(acc, e.currentTarget)}
                onMouseLeave={hidePopover}
              >
                <Avatar id={acc.id ?? acc.name} name={acc.name} avatar={acc.avatar} />
                <span className="user-name">
                  {acc.name}
                  {acc.admin ? (
                    <span className={`user-admin-badge ${isMasterUser(acc) ? 'user-admin-badge--master' : ''}`} title={isMasterUser(acc) ? 'Master Admin' : 'Admin'}>
                      {isMasterUser(acc) ? 'Master' : 'Admin'}
                    </span>
                  ) : acc.tags?.[0] ? (
                    <span className="user-tag" style={{ background: tagColor(acc.tags[0]), borderColor: tagColor(acc.tags[0]) }}>{acc.tags[0]}</span>
                  ) : null}
                </span>
                {acc.id && <span className="user-offline-dot" title={t('offline')} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {popover && (
        <UserInfoPopup
          user={popover.user}
          left={popover.left}
          top={popover.top}
          onMouseEnter={clearHide}
          onMouseLeave={hidePopover}
        />
      )}
    </div>
  )
}
