import React, { useEffect, useState, useRef } from 'react'
import { LiveViewer } from '../components/LiveViewer.tsx'
import { connectToServer, joinRoom } from '../services/connectionService.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'

export function ViewerPage() {
  const params = new URLSearchParams(window.location.search)
  const host = params.get('host') ?? ''
  const port = params.get('port') ?? ''
  const room = params.get('room') ?? 'Ao vivo'
  const broadcaster = params.get('broadcaster') || undefined
  const connected = useConnectionStore((s) => s.connected)
  const broadcasters = useLiveStore((s) => s.broadcasters)
  const [error, setError] = useState('')
  const [joined, setJoined] = useState(false)
  const joiningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!host || !port) {
      setError('Parâmetros "host" e "port" são obrigatórios na URL')
      return
    }
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${protocol}://${host}:${port}`
    connectToServer(url, '', '', undefined, 'guest')
    return () => {
      if (joiningTimer.current) clearTimeout(joiningTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!connected || joined) return
    joiningTimer.current = setTimeout(() => {
      joinRoom(room)
      setJoined(true)
    }, 500)
    return () => {
      if (joiningTimer.current) clearTimeout(joiningTimer.current)
    }
  }, [connected, joined])

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
        <div className="viewer-waiting">{broadcaster ? 'Aguardando câmera...' : 'Aguardando live...'}</div>
      </div>
    )
  }

  return (
    <div className="viewer-page">
      <LiveViewer minimal targetBroadcasterId={broadcaster} />
    </div>
  )
}
