import React, { useEffect, useState, useRef } from 'react'
import { LiveViewer } from '../components/LiveViewer.tsx'
import { connectToServer } from '../services/connectionService.ts'
import { joinRoom } from '../services/connectionService.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'

export function ViewerPage() {
  const params = new URLSearchParams(window.location.search)
  const host = params.get('host') ?? ''
  const port = params.get('port') ?? ''
  const room = params.get('room') ?? 'Ao vivo'
  const connected = useConnectionStore((s) => s.connected)
  const rooms = useRoomStore((s) => s.rooms)
  const broadcasters = useLiveStore((s) => s.broadcasters)
  const [error, setError] = useState('')
  const [joined, setJoined] = useState(false)
  const prevConnected = useRef(false)
  const prevRoomsLen = useRef(0)

  useEffect(() => {
    if (!host || !port) {
      setError('Parâmetros "host" e "port" são obrigatórios na URL')
      return
    }
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${protocol}://${host}:${port}`
    connectToServer(url, '', '', undefined, 'guest')
  }, [])

  useEffect(() => {
    if (!connected) return
    if (connected && !prevConnected.current) {
      prevConnected.current = true
    }
    if (rooms.length > 0 && rooms.length !== prevRoomsLen.current && !joined) {
      prevRoomsLen.current = rooms.length
      const decodedRoom = decodeURIComponent(room)
      const targetRoom = rooms.find((r) => r.name === room || r.name === decodedRoom)
      if (targetRoom) {
        joinRoom(targetRoom.name)
        setJoined(true)
      }
    }
  }, [connected, rooms])

  if (error) {
    return (
      <div className="viewer-page">
        <div className="viewer-error">{error}</div>
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="viewer-page">
        <div className="viewer-loading">Conectando...</div>
      </div>
    )
  }

  if (broadcasters.length === 0) {
    return (
      <div className="viewer-page">
        <div className="viewer-waiting">Aguardando live...</div>
      </div>
    )
  }

  return (
    <div className="viewer-page">
      <LiveViewer minimal />
    </div>
  )
}
