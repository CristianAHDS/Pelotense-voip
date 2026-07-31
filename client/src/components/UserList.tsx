import React, { useEffect } from 'react'
import { useRooms } from '../hooks/useRooms.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { useVoiceStore, SPEAKING_TIMEOUT_MS } from '../stores/voiceStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { sendLiveForceStop } from '../services/connectionService.ts'

export function UserList() {
  const connected = useConnectionStore((s) => s.connected)
  const { users } = useRooms()
  const myId = useConnectionStore((s) => s.id)
  const myAdmin = useConnectionStore((s) => s.admin)
  const openChat = usePrivateChatStore((s) => s.openChat)
  const activeUserId = usePrivateChatStore((s) => s.activeUserId)
  const unread = usePrivateChatStore((s) => s.unread)
  const speaking = useVoiceStore((s) => s.speaking)
  const broadcaster = useLiveStore((s) => s.broadcaster)

  useEffect(() => {
    const timer = setInterval(() => useVoiceStore.getState().pruneSpeaking(), 200)
    return () => clearInterval(timer)
  }, [])

  if (!connected) return null

  function handleClick(userId: string, userName: string) {
    if (userId === myId) return
    openChat(userId, userName)
  }

  return (
    <div className="panel user-list">
      <h2>Users ({users.length})</h2>
      <div className="user-list-items">
        {users.map((user) => {
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
            >
              <span className="user-name">
                {user.name}{isMe ? ' (you)' : ''}
                {user.admin && <span className="user-admin-badge" title="Admin">Admin</span>}
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
        <p className="empty-state">No users connected</p>
      )}
    </div>
  )
}
