import React, { useState } from 'react'
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
        host: parsed.host ?? '192.168.8.94',
        port: parsed.port ?? '3001',
        name: parsed.name ?? '',
        password: parsed.password ?? '',
      }
    }
  } catch { /* ignore */ }
  return { host: '192.168.8.94', port: '3001', name: '', password: '' }
}

function saveStored(host: string, port: string, name: string, password: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ host, port, name, password }))
  } catch (e) {
    console.error('Failed to save credentials:', e)
  }
}

export function ConnectionPanel() {
  const { connected, id, name: connectedName, serverHost, serverWsPort, disconnect } = useConnection()
  const reconnecting = useConnectionStore((s) => s.reconnecting)
  const setServerHost = useSettingsStore((s) => s.setServerHost)
  const setServerWsPort = useSettingsStore((s) => s.setServerWsPort)

  const [stored] = useState(() => loadStored())
  const [host, setHost] = useState(stored.host)
  const [port, setPort] = useState(stored.port)
  const [nickname, setNickname] = useState(stored.name)
  const [password, setPassword] = useState(stored.password)

  function persist() {
    saveStored(host, port, nickname, password)
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

  function handleConnect() {
    persist()
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
              onChange={(e) => { const v = e.target.value; setHost(v); saveStored(v, port, nickname, password) }}
              placeholder="Server IP"
              className="input"
            />
            <input
              type="number"
              value={port}
              onChange={(e) => { const v = e.target.value; setPort(v); saveStored(host, v, nickname, password) }}
              placeholder="Port"
              className="input"
            />
          </div>
          <div className="auth-inputs">
            <input
              type="text"
              value={nickname}
              onChange={(e) => { const v = e.target.value; setNickname(v); saveStored(host, port, v, password) }}
              placeholder="Nickname"
              className="input"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => { const v = e.target.value; setPassword(v); saveStored(host, port, nickname, v) }}
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
