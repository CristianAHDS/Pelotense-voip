import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useConnection } from '../hooks/useConnection.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useAccountStore, clearAccountPrefs } from '../stores/accountStore.ts'
import { connectToServer } from '../services/connectionService.ts'
import { useT } from '../i18n/index.ts'
import { isTauri } from '../utils/isTauri.ts'

const STORAGE_KEY = 'voip_credentials'
const IS_HTTPS = window.location.protocol === 'https:' || isTauri()
const DEFAULT_HOST = (import.meta.env.VITE_SERVER_HOST as string | undefined) || 'pelotense-voip.fly.dev'
const DEFAULT_WS_PORT = (import.meta.env.VITE_WS_PORT as string | undefined) || '3001'
const DEFAULT_WSS_PORT = (import.meta.env.VITE_WSS_PORT as string | undefined) || '443'

type AuthMode = 'login' | 'register'

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        host: parsed.host ?? DEFAULT_HOST,
        wsPort: parsed.wsPort ?? DEFAULT_WS_PORT,
        wssPort: parsed.wssPort ?? DEFAULT_WSS_PORT,
        name: parsed.name ?? '',
        email: parsed.email ?? '',
        password: parsed.password ?? '',
      }
    }
  } catch { /* ignore */ }
  return { host: DEFAULT_HOST, wsPort: DEFAULT_WS_PORT, wssPort: DEFAULT_WSS_PORT, name: '', email: '', password: '' }
}

function saveStored(host: string, wsPort: string, wssPort: string, name: string, email: string, password: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ host, wsPort, wssPort, name, email, password }))
  } catch (e) {
    console.error('Failed to save credentials:', e)
  }
}

function clearStoredCredentials(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    saveStored(
      parsed.host ?? DEFAULT_HOST,
      parsed.wsPort ?? DEFAULT_WS_PORT,
      parsed.wssPort ?? DEFAULT_WSS_PORT,
      '',
      '',
      '',
    )
  } catch { /* ignore */ }
}

export function ConnectionPanel() {
  const { connected, id, name: connectedName, disconnect } = useConnection()
  const reconnecting = useConnectionStore((s) => s.reconnecting)
  const t = useT()

  const [stored] = useState(() => loadStored())
  const [host, setHost] = useState(stored.host)
  const [wsPort, setWsPort] = useState(stored.wsPort)
  const [wssPort, setWssPort] = useState(stored.wssPort)
  const [nickname, setNickname] = useState(stored.name)
  const [email, setEmail] = useState(stored.email)
  const [password, setPassword] = useState(stored.password)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [mode, setMode] = useState<AuthMode>('login')
  const [localError, setLocalError] = useState('')
  const [certAccepted, setCertAccepted] = useState(false)
  const [restoring, setRestoring] = useState(!!stored.name)
  const loginError = useConnectionStore((s) => s.loginError)

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

  const autoConnectRef = useRef(false)

  useEffect(() => {
    if (autoConnectRef.current) return
    autoConnectRef.current = true
    if (!connected && stored.name) {
      const protocol = IS_HTTPS ? 'wss' : 'ws'
      const port = IS_HTTPS ? stored.wssPort : stored.wsPort
      connectToServer(`${protocol}://${stored.host}:${port}`, stored.name, stored.password, stored.email, 'login')
    }
  }, [])

  // Enquanto há credenciais salvas e a conexão ainda não estabilizou (nem
  // conectada nem falhou), mostra um skeleton em vez do formulário/status.
  useEffect(() => {
    if (!stored.name) {
      setRestoring(false)
      return
    }
    if (connected) {
      setRestoring(false)
      return
    }
    const timer = setTimeout(() => setRestoring(false), 2500)
    return () => clearTimeout(timer)
  }, [connected, stored.name, reconnecting])

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
    const trimmedName = nickname.trim()
    if (mode === 'register') {
      if (!trimmedName) {
        setLocalError(t('nameRequired'))
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setLocalError(t('invalidEmail'))
        return
      }
      if (!password) {
        setLocalError(t('passwordRequired'))
        return
      }
      if (password !== confirmPassword) {
        setLocalError(t('passwordMismatch'))
        return
      }
    } else {
      if (!trimmedName) {
        setLocalError(t('loginNameRequired'))
        return
      }
      if (!password) {
        setLocalError(t('passwordRequired'))
        return
      }
    }
    setLocalError('')
    saveStored(host, wsPort, wssPort, trimmedName, email, password)
    const protocol = useWss ? 'wss' : 'ws'
    connectToServer(`${protocol}://${host}:${activePort}`, trimmedName, password, email || undefined, mode)
  }

  // Entrada como convidado: não exige nome/senha — o servidor gera "guest###"
  // com as regras do modo convidado (áudio/vídeo/live, sem texto/DM).
  function handleGuest() {
    setLocalError('')
    const protocol = useWss ? 'wss' : 'ws'
    connectToServer(`${protocol}://${host}:${activePort}`, '', '', undefined, 'guest')
  }

  function handleDisconnect() {
    disconnect()
    clearStoredCredentials()
    clearAccountPrefs()
    setNickname('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setLocalError('')
    useAccountStore.getState().setPrefs({ name: '', email: '', password: '', avatar: '' })
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

  function fillDefault() {
    const v = DEFAULT_HOST
    setHost(v)
    setWsPort(DEFAULT_WS_PORT)
    setWssPort(DEFAULT_WSS_PORT)
    saveStored(v, DEFAULT_WS_PORT, DEFAULT_WSS_PORT, nickname, email, password)
  }

  const authError = localError || loginError

  return (
    <div className="panel connection-panel">
      {restoring ? (
        <div className="connection-skeleton" aria-busy="true" aria-label={t('restoringSession')}>
          <div className="skeleton skeleton-pill" style={{ width: '70%' }} />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </div>
      ) : (
        <>
          <div className="connection-status">
            <span className={`status-indicator ${statusClass}`} />
            <span>{statusText}</span>
          </div>
          {id && !reconnecting && <div className="client-id">ID: {id}</div>}
          {!connected && (
            <>
              <div className="auth-tabs" role="tablist" aria-label="Autenticação">
                <button
                  role="tab"
                  aria-selected={mode === 'login'}
                  className={`auth-tab ${mode === 'login' ? 'auth-tab--active' : ''}`}
                  onClick={() => { setMode('login'); setLocalError('') }}
                >
                  {t('loginTitle')}
                </button>
                <button
                  role="tab"
                  aria-selected={mode === 'register'}
                  className={`auth-tab ${mode === 'register' ? 'auth-tab--active' : ''}`}
                  onClick={() => { setMode('register'); setLocalError('') }}
                >
                  {t('registerTitle')}
                </button>
              </div>

              {mode === 'login' ? (
                <>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-nickname">{t('loginIdentifier')}</label>
                    <input
                      id="cp-nickname"
                      type="text"
                      value={nickname}
                      onChange={(e) => { const v = e.target.value; setNickname(v); saveStored(host, wsPort, wssPort, v, email, password) }}
                      placeholder={t('loginNamePlaceholder')}
                      autoComplete="username"
                      className="input"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-password">{t('loginPasswordPlaceholder')}</label>
                    <input
                      id="cp-password"
                      type="password"
                      value={password}
                      onChange={(e) => { const v = e.target.value; setPassword(v); saveStored(host, wsPort, wssPort, nickname, email, v) }}
                      placeholder={t('loginPasswordPlaceholder')}
                      autoComplete="current-password"
                      className="input"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-reg-name">{t('registerName')}</label>
                    <input
                      id="cp-reg-name"
                      type="text"
                      value={nickname}
                      onChange={(e) => { const v = e.target.value; setNickname(v); saveStored(host, wsPort, wssPort, v, email, password) }}
                      placeholder={t('loginNamePlaceholder')}
                      autoComplete="username"
                      className="input"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-reg-email">{t('email')}</label>
                    <input
                      id="cp-reg-email"
                      type="email"
                      value={email}
                      onChange={(e) => { const v = e.target.value; setEmail(v); saveStored(host, wsPort, wssPort, nickname, v, password) }}
                      placeholder={t('emailPlaceholder')}
                      autoComplete="email"
                      className="input"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-reg-password">{t('loginPasswordPlaceholder')}</label>
                    <input
                      id="cp-reg-password"
                      type="password"
                      value={password}
                      onChange={(e) => { const v = e.target.value; setPassword(v); saveStored(host, wsPort, wssPort, nickname, email, v) }}
                      placeholder={t('loginPasswordPlaceholder')}
                      autoComplete="new-password"
                      className="input"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-reg-confirm">{t('confirmPassword')}</label>
                    <input
                      id="cp-reg-confirm"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t('confirmPassword')}
                      autoComplete="new-password"
                      className="input"
                    />
                  </div>
                </>
              )}

              <details className="server-config">
                <summary>{t('serverConfig')}</summary>
                <div className="field">
                  <label className="field-label" htmlFor="cp-host">Servidor</label>
                  <div className="server-inputs">
                    <input
                      id="cp-host"
                      type="text"
                      value={host}
                      onChange={(e) => { const v = e.target.value; setHost(v); saveStored(v, wsPort, wssPort, nickname, email, password) }}
                      placeholder="Server IP"
                      className="input"
                    />
                    <input
                      id="cp-port"
                      type="number"
                      value={activePort}
                      onChange={(e) => {
                        const v = e.target.value
                        if (useWss) { setWssPort(v); saveStored(host, wsPort, v, nickname, email, password) }
                        else { setWsPort(v); saveStored(host, v, wssPort, nickname, email, password) }
                      }}
                      placeholder={useWss ? 'WSS Port' : 'Port'}
                      className="input"
                    />
                  </div>
                </div>
                <button type="button" className="btn btn-fill-default" onClick={fillDefault}>
                  Preencher padrão ({DEFAULT_HOST})
                </button>
              </details>

              {authError && <div className="form-error" role="alert">{authError}</div>}
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
            <button onClick={handleDisconnect} className="btn btn-disconnect">
              Disconnect
            </button>
          ) : (
            <>
              <button onClick={handleConnect} disabled={reconnecting} className="btn btn-connect">
                {reconnecting ? 'Reconnecting...' : mode === 'register' ? t('registerButton') : t('loginButton')}
              </button>
              {mode === 'login' && (
                <button onClick={handleGuest} disabled={reconnecting} className="btn btn-guest" title={t('guestHint')}>
                  {t('guestButton')}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
