import React, { useState, useEffect, useCallback } from 'react'
import { useConnection } from '../hooks/useConnection.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { connectToServer } from '../services/connectionService.ts'

const STORAGE_KEY = 'voip_credentials'
const IS_HTTPS = window.location.protocol === 'https:'

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        host: parsed.host ?? '192.168.8.94',
        wsPort: parsed.wsPort ?? '3001',
        wssPort: parsed.wssPort ?? '3003',
        name: parsed.name ?? '',
        password: parsed.password ?? '',
      }
    }
  } catch { /* ignore */ }
  return { host: '192.168.8.94', wsPort: '3001', wssPort: '3003', name: '', password: '' }
}

function saveStored(host: string, wsPort: string, wssPort: string, name: string, password: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ host, wsPort, wssPort, name, password }))
  } catch (e) {
    console.error('Failed to save credentials:', e)
  }
}

export function ConnectionPanel() {
  const { connected, id, name: connectedName, disconnect } = useConnection()
  const reconnecting = useConnectionStore((s) => s.reconnecting)

  const [stored] = useState(() => loadStored())
  const [host, setHost] = useState(stored.host)
  const [wsPort, setWsPort] = useState(stored.wsPort)
  const [wssPort, setWssPort] = useState(stored.wssPort)
  const [nickname, setNickname] = useState(stored.name)
  const [password, setPassword] = useState(stored.password)
  const [certAccepted, setCertAccepted] = useState(false)

  const useWss = IS_HTTPS
  const activePort = useWss ? wssPort : wsPort
  const httpsClientPort = 3443

  const checkCert = useCallback(async () => {
    if (!useWss) {
      setCertAccepted(true)
      return
    }
    try {
      const url = `https://${host}:${wssPort}/`
      await fetch(url, { mode: 'no-cors', cache: 'no-store' })
      setCertAccepted(true)
    } catch {
      setCertAccepted(false)
    }
  }, [host, wssPort, useWss])

  const checkHttpsClient = useCallback(async () => {
    try {
      const url = `https://${host}:${httpsClientPort}/`
      await fetch(url, { mode: 'no-cors', cache: 'no-store' })
      return true
    } catch {
      return false
    }
  }, [host])

  useEffect(() => {
    checkCert()
  }, [checkCert])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkCert()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [checkCert])

  function handleConnect() {
    saveStored(host, wsPort, wssPort, nickname, password)
    const protocol = useWss ? 'wss' : 'ws'
    connectToServer(`${protocol}://${host}:${activePort}`, nickname, password)
  }

  const statusText = reconnecting
    ? 'Reconnecting...'
    : connected
      ? `Connected as ${connectedName}`
      : 'Disconnected'

  const statusClass = reconnecting
    ? 'reconnecting'
    : connected
      ? 'connected'
      : 'disconnected'

  return (
    <div className="panel connection-panel">
      <div className="connection-status">
        <span className={`status-indicator ${statusClass}`} />
        <span>{statusText}</span>
      </div>
      {id && !reconnecting && <div className="client-id">ID: {id}</div>}
      {!connected && (
        <>
          <div className="server-inputs">
            <input
              type="text"
              value={host}
              onChange={(e) => { const v = e.target.value; setHost(v); saveStored(v, wsPort, wssPort, nickname, password) }}
              placeholder="Server IP"
              className="input"
            />
            <input
              type="number"
              value={activePort}
              onChange={(e) => {
                const v = e.target.value
                if (useWss) { setWssPort(v); saveStored(host, wsPort, v, nickname, password) }
                else { setWsPort(v); saveStored(host, v, wssPort, nickname, password) }
              }}
              placeholder={useWss ? 'WSS Port' : 'Port'}
              className="input"
            />
          </div>
          <div className="auth-inputs">
            <input
              type="text"
              value={nickname}
              onChange={(e) => { const v = e.target.value; setNickname(v); saveStored(host, wsPort, wssPort, v, password) }}
              placeholder="Nickname"
              className="input"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => { const v = e.target.value; setPassword(v); saveStored(host, wsPort, wssPort, nickname, v) }}
              placeholder="Password"
              className="input"
            />
          </div>
          {useWss && !certAccepted && (
            <div className="wss-hint">
              Antes de conectar, acesse <a href={`https://${host}:${wssPort}/`} target="_blank" rel="noopener noreferrer">https://{host}:{wssPort}/</a> no navegador e aceite o certificado SSL.
              <button className="btn btn-verify-cert" onClick={checkCert}>Verificar</button>
            </div>
          )}
          {!useWss && (
            <div className="wss-hint">
              Para usar o microfone, acesse <a href={`https://${host}:${httpsClientPort}/`} target="_blank" rel="noopener noreferrer">https://{host}:{httpsClientPort}/</a> e aceite o certificado SSL.
              <button className="btn btn-verify-cert" onClick={checkHttpsClient}>Verificar</button>
            </div>
          )}
        </>
      )}
      {connected ? (
        <button onClick={disconnect} className="btn btn-disconnect">
          Disconnect
        </button>
      ) : (
        <button onClick={handleConnect} disabled={reconnecting} className="btn btn-connect">
          {reconnecting ? 'Reconnecting...' : 'Connect'}
        </button>
      )}
    </div>
  )
}
