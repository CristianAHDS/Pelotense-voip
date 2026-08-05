import React, { useEffect, useState, useRef, Suspense, lazy } from 'react'
import { connectToServer, joinRoom } from '../services/connectionService.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { loadAppConfig } from '../utils/appConfig.ts'

const ChatPanel = lazy(() => import('../components/ChatPanel.tsx').then(m => ({ default: m.ChatPanel })))

// Detecta se o hostname parece ser um túnel público.
function isTunnelHost(host: string): boolean {
  return host.includes('trycloudflare.com')
    || host.includes('ngrok')
    || host.includes('lhr.life')
    || host.includes('fly.dev')
}

export function JoinPage() {
  const params = new URLSearchParams(window.location.search)
  const room = params.get('room') ?? ''
  const connected = useConnectionStore((s) => s.connected)
  const currentRoom = useRoomStore((s) => s.currentRoomName)
  const [status, setStatus] = useState('Conectando...')
  const [error, setError] = useState('')
  const joiningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current || !room) return
    startedRef.current = true

    loadAppConfig().then((cfg) => {
      const hostParam = params.get('host')
      const portParam = params.get('port')
      let host: string
      let port: string
      let protocol: string

      if (hostParam && portParam) {
        host = hostParam
        port = portParam
        protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      } else if (cfg.host && isTunnelHost(cfg.host)) {
        host = cfg.host
        port = '443'
        protocol = 'wss'
      } else {
        host = window.location.hostname
        protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
        port = window.location.protocol === 'https:' ? '3003' : '3001'
      }

      setStatus(`Conectando a ${host}...`)
      connectToServer(`${protocol}://${host}:${port}`, '', '', undefined, 'guest')
    }).catch(() => {
      setError('Erro ao carregar configuração do servidor')
    })

    return () => {
      if (joiningTimer.current) clearTimeout(joiningTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!connected || !room) return
    setStatus('Entrando na sala...')
    joiningTimer.current = setTimeout(() => {
      joinRoom(room)
      setStatus('')
    }, 500)
    return () => {
      if (joiningTimer.current) clearTimeout(joiningTimer.current)
    }
  }, [connected, room])

  if (error) {
    return (
      <div className="viewer-page">
        <div className="viewer-error">{error}</div>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="viewer-page">
        <div className="viewer-error">Link inválido: sala não especificada.</div>
      </div>
    )
  }

  if (!connected || status) {
    return (
      <div className="viewer-page">
        <div className="viewer-loading">{status || 'Conectando...'}</div>
      </div>
    )
  }

  if (currentRoom) {
    return (
      <div className="app-container" style={{ minHeight: '100vh' }}>
        <div className="app-bg" aria-hidden="true" />
        <Suspense fallback={<div className="viewer-loading">Carregando chat...</div>}>
          <ChatPanel />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="viewer-page">
      <div className="viewer-loading">Entrando na sala #{room}...</div>
    </div>
  )
}
