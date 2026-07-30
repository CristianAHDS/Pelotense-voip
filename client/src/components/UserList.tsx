import React from 'react'
import { useRooms } from '../hooks/useRooms.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'

export function UserList() {
  const { users, currentRoom } = useRooms()
  const myId = useConnectionStore((s) => s.id)
  const openChat = usePrivateChatStore((s) => s.openChat)
  const activeUserId = usePrivateChatStore((s) => s.activeUserId)

  const roomUsers = currentRoom
    ? users.filter((u) => u.room === currentRoom)
    : users

  function handleClick(userId: string, userName: string) {
    if (userId === myId) return
    if (activeUserId === userId) {
      openChat(userId, userName)
    } else {
      openChat(userId, userName)
    }
  }

  return (
    <div className="panel user-list">
      <h2>Users ({roomUsers.length})</h2>
      <div className="user-list-items">
        {roomUsers.map((user) => {
          const isMe = user.id === myId
          const isActive = user.id === activeUserId
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
            </div>
          )
        })}
      </div>
      {roomUsers.length === 0 && (
        <p className="empty-state">No users connected</p>
      )}
    </div>
  )
}
