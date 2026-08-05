import React, { useEffect, useState, useRef, Suspense, lazy } from 'react'
import { connectToServer, joinRoom } from '../services/connectionService.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { loadAppConfig } from '../utils/appConfig.ts'
import { useT } from '../i18n/index.ts'

const MultiLiveMosaic = lazy(() => import('../components/MultiLiveMosaic.tsx').then(m => ({ default: m.MultiLiveMosaic })))

function isTunnelHost(host: string): boolean {
  return host.includes('trycloudflare.com')
    || host.includes('ngrok')
    || host.includes('lhr.life')
    || host.includes('fly.dev')
}

export function JoinPage() {
  const params = new URLSearchParams(window.location.search)
  const room = params.get('room') ?? 'Live'
  const connected = useConnectionStore((s) => s.connected)
  const currentRoom = useRoomStore((s) => s.currentRoomName)
  const broadcasters = useLiveStore((s) => s.broadcasters)
  const [status, setStatus] = useState('Conectando...')
  const [error, setError] = useState('')
  const joiningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedRef = useRef(false)
  const t = useT()

  useEffect(() => {
    if (startedRef.current) return
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
        <header className="app-header" style={{ justifyContent: 'center' }}>
          <h1>
            <img src="/img/radio-logo.png" alt="" className="app-logo" />
            <span className="app-title">Rádio Pelotense</span>
            <span className="app-title-freq">99.5 FM</span>
          </h1>
        </header>
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 16px 16px' }}>
          {broadcasters.length === 0 ? (
            <div className="empty-state" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <span className="empty-state-icon" style={{ fontSize: 48 }}>📡</span>
                <span className="empty-state-title" style={{ display: 'block', marginTop: 12 }}>Nenhuma live no ar</span>
                <span className="empty-state-hint" style={{ display: 'block', marginTop: 4 }}>Volte quando houver transmissões ao vivo.</span>
              </div>
            </div>
          ) : (
            <Suspense fallback={<div className="viewer-loading">Carregando lives...</div>}>
              <MultiLiveMosaic />
            </Suspense>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="viewer-page">
      <div className="viewer-loading">Entrando na sala #{room}...</div>
    </div>
  )
}
