import React, { useState, useEffect } from 'react'
import { RoomInfo } from '../types/index.ts'
import { useRooms } from '../hooks/useRooms.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useVoiceStore, SPEAKING_TIMEOUT_MS } from '../stores/voiceStore.ts'

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
  const myId = useConnectionStore((s) => s.id)
  const myAdmin = useConnectionStore((s) => s.admin)
  const { rooms, currentRoom, join, leave, create, delete: del } = useRooms()
  const users = useRoomStore((s) => s.users)
  const speaking = useVoiceStore((s) => s.speaking)
  const [newRoomName, setNewRoomName] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setCollapsed(false)
  }, [connected])

  if (!connected) return null

  const handleCreate = () => {
    if (newRoomName.trim()) {
      create(newRoomName.trim())
      setNewRoomName('')
    }
  }

  function creatorName(room: RoomInfo): string | null {
    if (room.createdByName) return room.createdByName
    if (room.createdBy) {
      const creator = users.find((u) => u.id === room.createdBy)
      if (creator) return creator.name
    }
    return null
  }

  function roomSpeaking(room: RoomInfo): boolean {
    if (!room || room.users === 0) return false
    const now = Date.now()
    return users.some((u) => {
      const ts = speaking[u.id]
      return u.room === room.id && !!ts && now - ts <= SPEAKING_TIMEOUT_MS
    })
  }

  const totalUsers = rooms.reduce((sum, r) => sum + r.users, 0)

  return (
    <div className="panel room-list">
      <h2>
        Rooms ({rooms.length})
        <button
          className="room-list-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label="Toggle rooms"
        >
          {collapsed ? '▸ Show' : '▾ Hide'}
        </button>
      </h2>

      {collapsed && (
        <p className="room-list-summary">
          {totalUsers} users across {rooms.length} rooms
        </p>
      )}

      <div className={`room-list-body ${collapsed ? 'room-list-body--collapsed' : ''}`}>
        <div className="room-list-items">
          {rooms.map((room) => {
            const roomUsers = users.filter((u) => u.room === room.id)
            const isLive = !!room.live
            const isSpeaking = roomSpeaking(room)
            const creator = creatorName(room)
            return (
              <div
                key={room.id}
                className={`room-item ${currentRoom === room.id ? 'active' : ''} ${room.fixed ? 'room-item--fixed' : ''} ${room.featured === 1 ? 'room-item--featured-1' : ''} ${room.featured === 2 ? 'room-item--featured-2' : ''} ${room.featured === 3 ? 'room-item--featured-3' : ''} ${isLive ? 'room-item--live' : ''} ${isSpeaking ? 'room-item--active-voice' : ''}`}
              >
                <div className="room-info">
                  <span className="room-name">
                    {room.name}
                    {isLive && (
                      <span className="room-live-badge" title={`${room.live?.userName ?? ''} is live`}>
                        LIVE
                      </span>
                    )}
                  </span>
                  <div className="room-meta">
                    <span className="room-users">
                      {room.users} users
                      {isLive && room.live?.userName && (
                        <span className="room-live-user">• {room.live.userName}</span>
                      )}
                    </span>
                    {room.users > 0 && (
                      <div
                        className="room-users-list"
                        title={roomUsers.map((u) => u.name).join(', ')}
                        data-tooltip={roomUsers.map((u) => u.name).join('\n')}
                      >
                        {roomUsers.slice(0, 5).map((u) => (
                          <span key={u.id} className="room-user-avatar" style={{ background: userColor(u.id) }} title={u.name}>
                            {u.name.charAt(0).toUpperCase()}
                          </span>
                        ))}
                        {room.users > 5 && (
                          <span className="room-user-more" title={roomUsers.slice(5).map((u) => u.name).join(', ')}>
                            +{room.users - 5}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {!room.fixed && creator && (
                    <div className="room-creator">
                      <span className="room-creator-avatar" style={{ background: userColor(room.createdBy ?? '') }}>
                        {creator.charAt(0).toUpperCase()}
                      </span>
                      <span className="room-creator-name">criada por {creator}</span>
                    </div>
                  )}
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
                  {!room.fixed && (myAdmin || room.createdBy === myId) && (
                    <button onClick={() => del(room.id)} className="btn btn-delete-room" title="Delete room">Delete</button>
                  )}
                </div>
              </div>
            )
          })}
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
    </div>
  )
}
