import React, { useState } from 'react'
import { useRooms } from '../hooks/useRooms.ts'

export function RoomList() {
  const { rooms, currentRoom, join, leave, create, delete: del } = useRooms()
  const [newRoomName, setNewRoomName] = useState('')

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
            className={`room-item ${currentRoom === room.id ? 'active' : ''}`}
          >
            <button onClick={() => del(room.id)} className="btn btn-delete-room" title="Delete room">&times;</button>
            <div className="room-info">
              <span className="room-name">{room.name}</span>
              <span className="room-users">{room.users} users</span>
            </div>
            {currentRoom === room.id ? (
              <button onClick={leave} className="btn btn-leave">
                Leave
              </button>
            ) : (
              <button onClick={() => join(room.name)} className="btn btn-join">
                Join
              </button>
            )}
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
        />
        <button onClick={handleCreate} className="btn btn-create">
          Create
        </button>
      </div>
    </div>
  )
}
