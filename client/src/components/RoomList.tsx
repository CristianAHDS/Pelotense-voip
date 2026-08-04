import React, { useState, useEffect, useRef } from 'react'
import { RoomInfo } from '../types/index.ts'
import { useRooms } from '../hooks/useRooms.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useVoiceStore, SPEAKING_TIMEOUT_MS } from '../stores/voiceStore.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { useT } from '../i18n/index.ts'
import { RADIO_ROOM_NAME, RADIO_BOT } from '../ui/radioBot.ts'

export function RoomList() {
  const connected = useConnectionStore((s) => s.connected)
  const myId = useConnectionStore((s) => s.id)
  const myAdmin = useConnectionStore((s) => s.admin)
  const { rooms, currentRoom, join, leave, create, delete: del } = useRooms()
  const users = useRoomStore((s) => s.users)
  const speaking = useVoiceStore((s) => s.speaking)
  const unread = useRoomStore((s) => s.unread)
  const loadingRooms = useRoomStore((s) => s.loadingRooms)
  const [newRoomName, setNewRoomName] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [enteringRoom, setEnteringRoom] = useState<string | null>(null)
  const createInputRef = useRef<HTMLInputElement>(null)
  const t = useT()

  useEffect(() => {
    setCollapsed(false)
  }, [connected])

  // Ao entrar numa sala, marca o card com a animação de entrada (escala).
  useEffect(() => {
    if (!currentRoom) {
      setEnteringRoom(null)
      return
    }
    setEnteringRoom(currentRoom)
    const t = setTimeout(() => setEnteringRoom(null), 700)
    return () => clearTimeout(t)
  }, [currentRoom])

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
        {t('roomsWithCount', { count: rooms.length })}
        <button
          className="room-list-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={t('toggleRooms')}
        >
          {collapsed ? `▸ ${t('show')}` : `▾ ${t('hide')}`}
        </button>
      </h2>

      {collapsed && (
        <p className="room-list-summary">
          {t('usersAcrossRooms', { users: totalUsers, rooms: rooms.length })}
        </p>
      )}

      <div className={`room-list-body ${collapsed ? 'room-list-body--collapsed' : ''}`}>
        {loadingRooms ? (
          <div className="skeleton-list" aria-busy="true" aria-label={t('loadingRooms')}>
            <div className="skeleton skeleton-pill" />
            <div className="skeleton skeleton-pill" />
            <div className="skeleton skeleton-pill" />
          </div>
        ) : (
          <>
            <div className="room-list-items">
          {rooms.map((room) => {
            const roomUsers = users.filter((u) => u.room === room.id)
            const withBot = room.name === RADIO_ROOM_NAME
              ? [{ id: RADIO_BOT.id, name: RADIO_BOT.name, room: room.id }, ...roomUsers]
              : roomUsers
            const occupantCount = withBot.length
            const isLive = !!room.live
            const isSpeaking = roomSpeaking(room)
            const creator = creatorName(room)
            return (
              <div
                key={room.id}
                className={`room-item ${currentRoom === room.id ? 'active' : ''} ${enteringRoom === room.id ? 'room-item--entering' : ''} ${room.fixed ? 'room-item--fixed' : ''} ${room.featured === 1 ? 'room-item--featured-1' : ''} ${room.featured === 2 ? 'room-item--featured-2' : ''} ${room.featured === 3 ? 'room-item--featured-3' : ''} ${isLive ? 'room-item--live' : ''} ${isSpeaking ? 'room-item--active-voice' : ''}`}
                onDoubleClick={() => { if (currentRoom !== room.id) join(room.name) }}
              >
                <div className="room-info">
                  <span className="room-name">
                    {room.name}
                    {currentRoom === room.id && (
                      <span className="room-current-badge" title={t('youAreHere')}>
                        {t('youAreHere')}
                      </span>
                    )}
                    {isLive && (
                      <span className="room-live-badge" title={t('isLiveTooltip', { name: room.live?.userName ?? '' })}>
                        {t('liveBadge')}
                      </span>
                    )}
                    {isSpeaking && (
                      <span className="room-eq" aria-hidden="true">
                        <i /><i /><i />
                      </span>
                    )}
                  </span>
                  <div className="room-meta">
                    <span className="room-users">
                      {t('usersCount', { n: room.users })}
                      {isLive && room.live?.userName && (
                        <span className="room-live-user">• {room.live.userName}</span>
                      )}
                    </span>
                    {room.users > 0 || withBot.length > 0 ? (
                      <div
                        className="room-users-list"
                        title={withBot.map((u) => u.name).join(', ')}
                        data-tooltip={withBot.map((u) => u.name).join('\n')}
                      >
                        {withBot.slice(0, 5).map((u) => (
                          <Avatar key={u.id} id={u.id} name={u.name} avatar={u.avatar} maxInitials={1} className={`room-user-avatar ${speaking[u.id] ? 'room-user-avatar--speaking' : ''}`} />
                        ))}
                        {occupantCount > 5 && (
                          <span className="room-user-more" title={withBot.slice(5).map((u) => u.name).join(', ')}>
                            +{occupantCount - 5}
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>
                  {!room.fixed && creator && (
                    <div className="room-creator">
                      <Avatar id={room.createdBy ?? ''} name={creator} maxInitials={1} className="room-creator-avatar" />
                      <span className="room-creator-name">{t('createdBy', { name: creator })}</span>
                    </div>
                  )}
                </div>
                <div className="room-actions">
                  {currentRoom === room.id ? (
                    <button onClick={leave} className="btn btn-leave">
                      {t('leave')}
                    </button>
                  ) : (
                    <button onClick={() => join(room.name)} className="btn btn-join">
                      {t('join')}
                    </button>
                  )}
                  {!room.fixed && (myAdmin || room.createdBy === myId) && (
                    <button onClick={() => del(room.id)} className="btn btn-delete-room" title={t('deleteRoom')}>{t('deleteRoom')}</button>
                  )}
                </div>
                {unread[room.id] > 0 && (
                  <span className="room-unread-badge" title={t('newUnread', { count: unread[room.id] })}>
                    {unread[room.id] > 99 ? '99+' : unread[room.id]}
                  </span>
                )}
              </div>
            )
          })}
            </div>
          </>
        )}
        {!loadingRooms && rooms.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon">📻</span>
            <span className="empty-state-title">{t('noRoomsYet')}</span>
            <span className="empty-state-hint">{t('noRoomsHint')}</span>
            <button
              className="empty-state-cta"
              onClick={() => createInputRef.current?.focus()}
            >
              {t('createRoomCta')}
            </button>
          </div>
        )}

        <div className="create-room">
          <input
            ref={createInputRef}
            type="text"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            placeholder={t('roomNamePlaceholder')}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="input"
          />
          <button onClick={handleCreate} className="btn btn-create">
            {t('create')}
          </button>
        </div>
      </div>
    </div>
  )
}
