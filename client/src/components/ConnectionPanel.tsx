import React, { useState, useEffect } from 'react'
import { useConnection } from '../hooks/useConnection.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useSettingsStore } from '../stores/settingsStore.ts'
import { connectToServer } from '../services/connectionService.ts'

const STORAGE_KEY = 'voip_credentials'

function loadStored(): { host: string; port: string; name: string; password: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        host: parsed.host ?? 'localhost',
        port: parsed.port ?? '3001',
        name: parsed.name ?? '',
        password: parsed.password ?? '',
      }
    }
  } catch { /* ignore */ }
  return { host: 'localhost', port: '3001', name: '', password: '' }
}

function saveStored(host: string, port: string, name: string, password: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ host, port, name, password }))
  } catch { /* ignore */ }
}

export function ConnectionPanel() {
  const { connected, id, name: connectedName, serverHost, serverWsPort, disconnect } = useConnection()
  const reconnecting = useConnectionStore((s) => s.reconnecting)
  const setServerHost = useSettingsStore((s) => s.setServerHost)
  const setServerWsPort = useSettingsStore((s) => s.setServerWsPort)
  const [initial] = useState(() => loadStored())
  const [host, setHost] = useState(initial.host)
  const [port, setPort] = useState(initial.port)
  const [nickname, setNickname] = useState(initial.name)
  const [password, setPassword] = useState(initial.password)

  useEffect(() => {
    if (connected) {
      saveStored(host, port, nickname, password)
    }
  }, [connected])

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

  function handleConnect() {
    setServerHost(host)
    setServerWsPort(Number(port))
    connectToServer(`ws://${host}:${port}`, nickname, password)
  }

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
              onChange={(e) => setHost(e.target.value)}
              placeholder="Server IP"
              className="input"
            />
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="Port"
              className="input"
            />
          </div>
          <div className="auth-inputs">
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Nickname"
              className="input"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="input"
            />
          </div>
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
