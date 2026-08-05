import React, { useEffect, useState, useRef } from 'react'
import { connectToServer, joinRoom } from '../services/connectionService.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { loadAppConfig } from '../utils/appConfig.ts'

export function JoinPage() {
  const params = new URLSearchParams(window.location.search)
  const room = params.get('room') ?? ''
  const connected = useConnectionStore((s) => s.connected)
  const [status, setStatus] = useState('Conectando...')
  const joiningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current || !room) return
    startedRef.current = true

    loadAppConfig().then((cfg) => {
      const host = params.get('host') || cfg.host || window.location.hostname
      const wssPort = cfg.wssPort || '443'
      const isTunnel = !!(cfg.host && (wssPort === '443' || wssPort === '80'))
      const protocol = isTunnel || window.location.protocol === 'https:' ? 'wss' : 'ws'
      const port = isTunnel ? wssPort : (window.location.protocol === 'https:' ? '3003' : '3001')

      const wsUrl = `${protocol}://${host}:${port}`
      connectToServer(wsUrl, '', '', undefined, 'guest')
    }).catch(() => {
      setStatus('Erro ao carregar configuração')
    })

    return () => {
      if (joiningTimer.current) clearTimeout(joiningTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    if (!room) {
      setStatus('Sala não especificada')
      return
    }
    setStatus('Entrando na sala...')
    joiningTimer.current = setTimeout(() => {
      joinRoom(room)
      // Redireciona para a página principal após entrar na sala
      setTimeout(() => {
        window.location.replace('/')
      }, 800)
    }, 500)
    return () => {
      if (joiningTimer.current) clearTimeout(joiningTimer.current)
    }
  }, [connected])

  if (!room) {
    return (
      <div className="viewer-page">
        <div className="viewer-error">Link inválido: sala não especificada.</div>
      </div>
    )
  }

  return (
    <div className="viewer-page">
      <div className="viewer-loading">{status}</div>
    </div>
  )
}
