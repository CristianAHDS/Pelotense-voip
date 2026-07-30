import React from 'react'
import { useRooms } from '../hooks/useRooms.ts'

export function UserList() {
  const { users, currentRoom } = useRooms()

  const roomUsers = currentRoom
    ? users.filter((u) => u.room === currentRoom)
    : users

  return (
    <div className="panel user-list">
      <h2>Users ({roomUsers.length})</h2>
      <div className="user-list-items">
        {roomUsers.map((user) => (
          <div key={user.id} className="user-item">
            <span className="user-name">{user.name}</span>
          </div>
        ))}
      </div>
      {roomUsers.length === 0 && (
        <p className="empty-state">No users connected</p>
      )}
    </div>
  )
}
