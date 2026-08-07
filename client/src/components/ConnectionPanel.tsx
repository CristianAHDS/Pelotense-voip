import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../hooks/useConnection.ts';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { useAccountStore, clearAccountPrefs } from '../stores/accountStore.ts';
import { connectToServer, joinRoom } from '../services/connectionService.ts';
import { useT } from '../i18n/index.ts';
import { isTauri } from '../utils/isTauri.ts';
import { loadAppConfig } from '../utils/appConfig.ts';

const STORAGE_KEY = 'voip_credentials';
const IS_HTTPS = window.location.protocol === 'https:' || isTauri();

// Quando o app é servido de um túnel (Cloudflare/ngrok), usa automaticamente
// esse mesmo host/porta (o túnel serve app + WebSocket). Para outros hosts
// públicos (ex: Netlify, que é estático e não tem WebSocket), NÃO autodetecta
// e mantém o config.json / padrão configurado.
const TUNNEL_HOST_RE =
  /\.(trycloudflare\.com|ngrok-free\.app|ngrok\.io|ngrok\.app)$/;

function resolveDefaults(): { host: string; wsPort: string; wssPort: string } {
  const envHost = import.meta.env.VITE_SERVER_HOST as string | undefined;
  const envWs = import.meta.env.VITE_WS_PORT as string | undefined;
  const envWss = import.meta.env.VITE_WSS_PORT as string | undefined;
  if (!isTauri() && typeof window !== 'undefined') {
    const servedHost = window.location.hostname || '';
    if (TUNNEL_HOST_RE.test(servedHost)) {
      return {
        host: envHost || servedHost,
        wsPort: envWs || window.location.port || '3001',
        wssPort: envWss || window.location.port || '443',
      };
    }
  }
  return {
    host: envHost || '192.168.8.94',
    wsPort: envWs || '3003',
    wssPort: envWss || '3003',
  };
}

const DEFAULTS = resolveDefaults();

type AuthMode = 'login' | 'register';

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        host: parsed.host ?? DEFAULTS.host,
        wsPort: parsed.wsPort ?? DEFAULTS.wsPort,
        wssPort: parsed.wssPort ?? DEFAULTS.wssPort,
        name: parsed.name ?? '',
        email: parsed.email ?? '',
        password: parsed.password ?? '',
      };
    }
  } catch {
    /* ignore */
  }
  return {
    host: DEFAULTS.host,
    wsPort: DEFAULTS.wsPort,
    wssPort: DEFAULTS.wssPort,
    name: '',
    email: '',
    password: '',
  };
}

function saveStored(
  host: string,
  wsPort: string,
  wssPort: string,
  name: string,
  email: string,
  password: string,
): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ host, wsPort, wssPort, name, email, password }),
    );
  } catch (e) {
    console.error('Failed to save credentials:', e);
  }
}

function clearStoredCredentials(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    saveStored(
      parsed.host ?? DEFAULTS.host,
      parsed.wsPort ?? DEFAULTS.wsPort,
      parsed.wssPort ?? DEFAULTS.wssPort,
      '',
      '',
      '',
    );
  } catch {
    /* ignore */
  }
}

export function ConnectionPanel() {
  const { connected, id, name: connectedName, disconnect } = useConnection();
  const reconnecting = useConnectionStore((s) => s.reconnecting);
  const t = useT();

  const [stored] = useState(() => loadStored());
  const [host, setHost] = useState(stored.host);
  const [wsPort, setWsPort] = useState(stored.wsPort);
  const [wssPort, setWssPort] = useState(stored.wssPort);
  const [nickname, setNickname] = useState(stored.name);
  const [email, setEmail] = useState(stored.email);
  const [password, setPassword] = useState(stored.password);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState<AuthMode>('login');
  const [localError, setLocalError] = useState('');
  const [certAccepted, setCertAccepted] = useState(false);
  const [restoring, setRestoring] = useState(!!stored.name);
  const loginError = useConnectionStore((s) => s.loginError);

  const useWss = IS_HTTPS;
  const activePort = useWss ? wssPort : wsPort;
  const httpsClientPort = 3443;

  // Aplica o config.json (link do Cloudflare/ngrok ao lado do exe) SEMPRE,
  // preenchendo o servidor/porta automaticamente e usando-o no auto-conectar.
  const autoConnectRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    loadAppConfig().then((cfg) => {
      if (!mounted) return;
      const hostCfg = cfg.host || DEFAULTS.host;
      const wsCfg = cfg.wsPort || DEFAULTS.wsPort;
      const wssCfg = cfg.wssPort || DEFAULTS.wssPort;
      setHost(hostCfg);
      setWsPort(wsCfg);
      setWssPort(wssCfg);

      // Auto-conecta com as credenciais salvas (se houver), usando o host do config.
      if (
        !autoConnectRef.current &&
        !useConnectionStore.getState().connected &&
        stored.name
      ) {
        autoConnectRef.current = true;
        const protocol = IS_HTTPS ? 'wss' : 'ws';
        const port = IS_HTTPS ? wssCfg : wsCfg;
        connectToServer(
          `${protocol}://${hostCfg}:${port}`,
          stored.name,
          stored.password,
          stored.email,
          'login',
        );
      } else if (
        !autoConnectRef.current &&
        !useConnectionStore.getState().connected
      ) {
        autoConnectRef.current = true;
        const joinParam = new URLSearchParams(window.location.search).get(
          'join',
        );
        if (joinParam) {
          const protocol = IS_HTTPS ? 'wss' : 'ws';
          const port = IS_HTTPS ? wssCfg : wsCfg;
          connectToServer(
            `${protocol}://${hostCfg}:${port}`,
            '',
            '',
            undefined,
            'guest',
          );
          // Aguarda a conexão e entra na sala
          const checkInterval = setInterval(() => {
            if (useConnectionStore.getState().connected) {
              clearInterval(checkInterval);
              joinRoom(decodeURIComponent(joinParam));
            }
          }, 300);
          setTimeout(() => clearInterval(checkInterval), 10000);
        }
      } else {
        autoConnectRef.current = true;
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const checkCert = useCallback(async () => {
    if (!useWss) {
      setCertAccepted(true);
      return;
    }
    try {
      const url = `https://${host}:${wssPort}/`;
      await fetch(url, { mode: 'no-cors', cache: 'no-store' });
      setCertAccepted(true);
    } catch {
      setCertAccepted(false);
    }
  }, [host, wssPort, useWss]);

  const checkHttpsClient = useCallback(async () => {
    try {
      const url = `https://${host}:${httpsClientPort}/`;
      await fetch(url, { mode: 'no-cors', cache: 'no-store' });
      return true;
    } catch {
      return false;
    }
  }, [host]);

  useEffect(() => {
    checkCert();
  }, [checkCert]);

  // Enquanto há credenciais salvas e a conexão ainda não estabilizou (nem
  // conectada nem falhou), mostra um skeleton em vez do formulário/status.
  useEffect(() => {
    if (!stored.name) {
      setRestoring(false);
      return;
    }
    if (connected) {
      setRestoring(false);
      return;
    }
    const timer = setTimeout(() => setRestoring(false), 2500);
    return () => clearTimeout(timer);
  }, [connected, stored.name, reconnecting]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkCert();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [checkCert]);

  function handleConnect() {
    const trimmedName = nickname.trim();
    if (mode === 'register') {
      if (!trimmedName) {
        setLocalError(t('nameRequired'));
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setLocalError(t('invalidEmail'));
        return;
      }
      if (!password) {
        setLocalError(t('passwordRequired'));
        return;
      }
      if (password !== confirmPassword) {
        setLocalError(t('passwordMismatch'));
        return;
      }
    } else {
      if (!trimmedName) {
        setLocalError(t('loginNameRequired'));
        return;
      }
      if (!password) {
        setLocalError(t('passwordRequired'));
        return;
      }
    }
    setLocalError('');
    saveStored(host, wsPort, wssPort, trimmedName, email, password);
    const protocol = useWss ? 'wss' : 'ws';
    connectToServer(
      `${protocol}://${host}:${activePort}`,
      trimmedName,
      password,
      email || undefined,
      mode,
    );
  }

  // Entrada como convidado: não exige nome/senha — o servidor gera "guest###"
  // com as regras do modo convidado (áudio/vídeo/live, sem texto/DM).
  function handleGuest() {
    setLocalError('');
    const protocol = useWss ? 'wss' : 'ws';
    connectToServer(
      `${protocol}://${host}:${activePort}`,
      '',
      '',
      undefined,
      'guest',
    );
  }

  function handleDisconnect() {
    disconnect();
    clearStoredCredentials();
    clearAccountPrefs();
    setNickname('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setLocalError('');
    useAccountStore
      .getState()
      .setPrefs({ name: '', email: '', password: '', avatar: '' });
  }

  const statusText = reconnecting
    ? t('statusReconnecting')
    : connected
      ? t('connectedAs', { name: connectedName ?? '' })
      : t('statusOffline');

  const statusClass = reconnecting
    ? 'reconnecting'
    : connected
      ? 'connected'
      : 'disconnected';

  function fillDefault() {
    // Preenche com o padrão fixo da rede local.
    setHost(DEFAULTS.host);
    setWsPort(DEFAULTS.wsPort);
    setWssPort(DEFAULTS.wssPort);
    saveStored(
      DEFAULTS.host,
      DEFAULTS.wsPort,
      DEFAULTS.wssPort,
      nickname,
      email,
      password,
    );
  }

  const authError = localError || loginError;

  return (
    <div className="panel connection-panel">
      {restoring ? (
        <div
          className="connection-skeleton"
          aria-busy="true"
          aria-label={t('restoringSession')}
        >
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
              <div
                className="auth-tabs"
                role="tablist"
                aria-label={t('authLabel')}
              >
                <button
                  role="tab"
                  aria-selected={mode === 'login'}
                  className={`auth-tab ${mode === 'login' ? 'auth-tab--active' : ''}`}
                  onClick={() => {
                    setMode('login');
                    setLocalError('');
                  }}
                >
                  {t('loginTitle')}
                </button>
                <button
                  role="tab"
                  aria-selected={mode === 'register'}
                  className={`auth-tab ${mode === 'register' ? 'auth-tab--active' : ''}`}
                  onClick={() => {
                    setMode('register');
                    setLocalError('');
                  }}
                >
                  {t('registerTitle')}
                </button>
              </div>

              {mode === 'login' ? (
                <>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-nickname">
                      {t('loginIdentifier')}
                    </label>
                    <input
                      id="cp-nickname"
                      type="text"
                      value={nickname}
                      onChange={(e) => {
                        const v = e.target.value;
                        setNickname(v);
                        saveStored(host, wsPort, wssPort, v, email, password);
                      }}
                      placeholder={t('loginNamePlaceholder')}
                      autoComplete="username"
                      className="input"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-password">
                      {t('loginPasswordPlaceholder')}
                    </label>
                    <input
                      id="cp-password"
                      type="password"
                      value={password}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPassword(v);
                        saveStored(host, wsPort, wssPort, nickname, email, v);
                      }}
                      placeholder={t('loginPasswordPlaceholder')}
                      autoComplete="current-password"
                      className="input"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-reg-name">
                      {t('registerName')}
                    </label>
                    <input
                      id="cp-reg-name"
                      type="text"
                      value={nickname}
                      onChange={(e) => {
                        const v = e.target.value;
                        setNickname(v);
                        saveStored(host, wsPort, wssPort, v, email, password);
                      }}
                      placeholder={t('loginNamePlaceholder')}
                      autoComplete="username"
                      className="input"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-reg-email">
                      {t('email')}
                    </label>
                    <input
                      id="cp-reg-email"
                      type="email"
                      value={email}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEmail(v);
                        saveStored(
                          host,
                          wsPort,
                          wssPort,
                          nickname,
                          v,
                          password,
                        );
                      }}
                      placeholder={t('emailPlaceholder')}
                      autoComplete="email"
                      className="input"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-reg-password">
                      {t('loginPasswordPlaceholder')}
                    </label>
                    <input
                      id="cp-reg-password"
                      type="password"
                      value={password}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPassword(v);
                        saveStored(host, wsPort, wssPort, nickname, email, v);
                      }}
                      placeholder={t('loginPasswordPlaceholder')}
                      autoComplete="new-password"
                      className="input"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="cp-reg-confirm">
                      {t('confirmPassword')}
                    </label>
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
                  <label className="field-label" htmlFor="cp-host">
                    {t('serverLabel')}
                  </label>
                  <div className="server-inputs">
                    <input
                      id="cp-host"
                      type="text"
                      value={host}
                      onChange={(e) => {
                        const v = e.target.value;
                        setHost(v);
                        saveStored(
                          v,
                          wsPort,
                          wssPort,
                          nickname,
                          email,
                          password,
                        );
                      }}
                      placeholder={t('serverIpPlaceholder')}
                      className="input"
                    />
                    <input
                      id="cp-port"
                      type="number"
                      value={activePort}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (useWss) {
                          setWssPort(v);
                          saveStored(
                            host,
                            wsPort,
                            v,
                            nickname,
                            email,
                            password,
                          );
                        } else {
                          setWsPort(v);
                          saveStored(
                            host,
                            v,
                            wssPort,
                            nickname,
                            email,
                            password,
                          );
                        }
                      }}
                      placeholder={
                        useWss ? t('wssPortPlaceholder') : t('portPlaceholder')
                      }
                      className="input"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-fill-default"
                  onClick={fillDefault}
                >
                  {t('fillDefault')}
                </button>
              </details>

              {authError && (
                <div className="form-error" role="alert">
                  {authError}
                </div>
              )}
              {useWss && !certAccepted && (
                <div className="wss-hint">
                  {t('wssHintConnectPre')}
                  <a
                    href={`https://${host}:${wssPort}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    https://{host}:{wssPort}/
                  </a>
                  {t('wssHintConnectPost')}
                  <button className="btn btn-verify-cert" onClick={checkCert}>
                    {t('verifyCert')}
                  </button>
                </div>
              )}
              {!useWss && (
                <div className="wss-hint">
                  {t('wssHintMicPre')}
                  <a
                    href={`https://${host}:${httpsClientPort}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    https://{host}:{httpsClientPort}/
                  </a>
                  {t('wssHintMicPost')}
                  <button
                    className="btn btn-verify-cert"
                    onClick={checkHttpsClient}
                  >
                    {t('verifyCert')}
                  </button>
                </div>
              )}
            </>
          )}
          {connected ? (
            <button onClick={handleDisconnect} className="btn btn-disconnect">
              {t('disconnect')}
            </button>
          ) : (
            <>
              <button
                onClick={handleConnect}
                disabled={reconnecting}
                className="btn btn-connect"
              >
                {reconnecting
                  ? t('reconnectingEllipsis')
                  : mode === 'register'
                    ? t('registerButton')
                    : t('loginButton')}
              </button>
              {mode === 'login' && (
                <button
                  onClick={handleGuest}
                  disabled={reconnecting}
                  className="btn btn-guest"
                  title={t('guestHint')}
                >
                  {t('guestButton')}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
