import React, { useState } from 'react'
import { useRooms } from '../hooks/useRooms.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'

const COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#14b8a6', '#f97316', '#06b6d4', '#ec4899', '#84cc16',
]

function userColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i)
    hash |= 0
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

export function RoomList() {
  const connected = useConnectionStore((s) => s.connected)
  const { rooms, currentRoom, join, leave, create, delete: del } = useRooms()
  const users = useRoomStore((s) => s.users)
  const [newRoomName, setNewRoomName] = useState('')

  if (!connected) return null

  const handleCreate = () => {
    if (newRoomName.trim()) {
      create(newRoomName.trim())
      setNewRoomName('')
    }
  }

  return (
    <div className="panel room-list">
      <h2>Rooms ({rooms.length})</h2>

      <div className="room-list-items">
        {rooms.map((room) => (
          <div
            key={room.id}
            className={`room-item ${currentRoom === room.id ? 'active' : ''} ${room.fixed ? 'room-item--fixed' : ''} ${room.featured === 1 ? 'room-item--featured-1' : ''} ${room.featured === 2 ? 'room-item--featured-2' : ''} ${room.featured === 3 ? 'room-item--featured-3' : ''}`}
          >
            <div className="room-info">
              <span className="room-name">{room.name}</span>
              <div className="room-meta">
                <span className="room-users">{room.users} users</span>
                {room.users > 0 && (
                  <div className="room-users-list">
                    {users.filter((u) => u.room === room.id).slice(0, 5).map((u) => (
                      <span key={u.id} className="room-user-avatar" style={{ background: userColor(u.id) }} title={u.name}>
                        {u.name.charAt(0).toUpperCase()}
                      </span>
                    ))}
                    {room.users > 5 && <span className="room-user-more">+{room.users - 5}</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="room-actions">
              {currentRoom === room.id ? (
                <button onClick={leave} className="btn btn-leave">
                  Leave
                </button>
              ) : (
                <button onClick={() => join(room.name)} className="btn btn-join">
                  Join
                </button>
              )}
              {!room.fixed && <button onClick={() => del(room.id)} className="btn btn-delete-room" title="Delete room">Delete</button>}
            </div>
          </div>
        ))}
      </div>

      {rooms.length === 0 && (
        <p className="empty-state">No rooms available</p>
      )}

      <div className="create-room">
        <input
          type="text"
          value={newRoomName}
          onChange={(e) => setNewRoomName(e.target.value)}
          placeholder="Room name"
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          className="input"
        />
        <button onClick={handleCreate} className="btn btn-create">
          Create
        </button>
      </div>
    </div>
  )
}
