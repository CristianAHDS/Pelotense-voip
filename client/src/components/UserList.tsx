import React from 'react'
import { useRooms } from '../hooks/useRooms.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'

export function UserList() {
  const connected = useConnectionStore((s) => s.connected)
  const { users } = useRooms()
  const myId = useConnectionStore((s) => s.id)

  if (!connected) return null
  const openChat = usePrivateChatStore((s) => s.openChat)
  const activeUserId = usePrivateChatStore((s) => s.activeUserId)
  const unread = usePrivateChatStore((s) => s.unread)

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
          return (
            <div
              key={user.id}
              className={`user-item ${isActive ? 'user-item--active' : ''} ${!isMe ? 'user-item--clickable' : ''}`}
              onClick={() => handleClick(user.id, user.name)}
              role={!isMe ? 'button' : undefined}
              tabIndex={!isMe ? 0 : undefined}
              onKeyDown={(e) => e.key === 'Enter' && handleClick(user.id, user.name)}
            >
              <span className="user-name">{user.name}{isMe ? ' (you)' : ''}</span>
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
