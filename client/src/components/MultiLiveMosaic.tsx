import React, { useRef, useEffect, useState } from 'react'
import { useLiveStore } from '../stores/liveStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useToastStore } from '../stores/toastStore.ts'
import { useVideoRecorder } from '../hooks/useVideoRecorder.ts'
import * as liveRtc from '../services/liveRtc.ts'
import { sendLiveStart, sendLiveStop } from '../services/connectionService.ts'
import { createStreamLevel } from '../audio/audioMeter.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { initials } from '../ui/avatar.ts'
import { isMobileDevice } from '../utils/device.ts'
import { getLiveViewerUrl } from '../utils/appConfig.ts'
import { useT } from '../i18n/index.ts'

function toggleVideoFullscreen(video: HTMLVideoElement): void {
  if (!document.fullscreenElement) {
    const req = (video.requestFullscreen ?? (video as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen)
    req?.call(video).catch(() => {})
  } else {
    const exit = document.exitFullscreen ?? (document as unknown as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen
    exit?.call(document).catch(() => {})
  }
}

function useFullscreenState(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  return isFullscreen
}

function FullscreenBtn({ videoRef, isFullscreen }: { videoRef: React.RefObject<HTMLVideoElement | null>; isFullscreen: boolean }) {
  const t = useT()
  return (
    <button
      className="mosaic-icon-btn"
      onClick={() => { if (videoRef.current) toggleVideoFullscreen(videoRef.current) }}
      title={isFullscreen ? t('closeFullscreen') : t('liveFullscreen')}
      aria-label={isFullscreen ? t('closeFullscreen') : t('liveFullscreen')}
    >
      {isFullscreen ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3v3a2 2 0 0 1-2 2H3" />
          <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
          <path d="M3 16h3a2 2 0 0 1 2 2v3" />
          <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      )}
    </button>
  )
}

// Nível de áudio de uma stream (para destacar o tile de quem está falando).
// Reutiliza o contexto compartilhado do audioMeter (evita AudioContext por
// tile, que o Chrome bloqueia por autoplay).
function useStreamLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    if (!stream) {
      setLevel(0)
      return
    }
    return createStreamLevel(stream, setLevel)
  }, [stream])
  return level
}

// Tempo decorrido desde um timestamp (atualiza a cada segundo).
function useElapsed(timestamp?: number): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!timestamp) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [timestamp])
  if (!timestamp) return ''
  const s = Math.max(0, Math.floor((now - timestamp) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

interface TileProps {
  userId: string
  userName: string
  timestamp?: number
  focused: boolean
  onFocus: () => void
  onBack: () => void
}

// Azulejo de um transmissor (que não seja eu): abre um RTCPeerConnection e
// mostra a câmera ao vivo dele, com placeholder enquanto o stream não chega.
function MosaicTile({ userId, userName, timestamp, focused, onFocus, onBack }: TileProps) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const avatar = useRoomStore((s) => s.users.find((u) => u.id === userId)?.avatar)
  const [hasStream, setHasStream] = useState(false)
  const [muted, setMuted] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const isFullscreen = useFullscreenState()
  const level = useStreamLevel(stream)
  const speaking = level > 0.12
  const elapsed = useElapsed(timestamp)

  useEffect(() => {
    setHasStream(false)
    setStream(null)
    const unsubscribe = liveRtc.startViewing(userId, (s) => {
      const el = videoRef.current
      if (!el || !s) return
      // O áudio sai pelo próprio <video> (imune ao bloqueio de autoplay do
      // AudioContext); o mute é controlado por el.muted. O nível (para destacar
      // quem fala) é medido via createStreamLevel.
      el.srcObject = s
      el.play().catch(() => {
        const onGesture = () => {
          document.removeEventListener('pointerdown', onGesture)
          el.play().catch(() => {})
        }
        document.addEventListener('pointerdown', onGesture, { once: true })
      })
      setStream(s)
      setHasStream(true)
    })
    return () => {
      unsubscribe()
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [userId])

  function toggleMute() {
    const next = !muted
    setMuted(next)
    if (videoRef.current) videoRef.current.muted = next
  }

  return (
    <div
      className={`mosaic-tile ${focused ? 'mosaic-tile--focused' : ''} ${speaking ? 'mosaic-tile--speaking' : ''}`}
      data-user-id={userId}
      onClick={onFocus}
    >
      <video ref={videoRef} autoPlay playsInline className="mosaic-tile-video" />
      {!hasStream && (
        <div className="mosaic-tile-placeholder">
          <span className="mosaic-tile-avatar">{initials(userName)}</span>
          <span className="mosaic-tile-spinner" />
          <span className="mosaic-tile-placeholder-name">{userName}</span>
        </div>
      )}
      <span className="mosaic-tile-badge">● {t('liveBadge')}</span>
      <div className="mosaic-tile-bar">
        <span className="mosaic-tile-bar-name">
          <Avatar id={userId} name={userName} avatar={avatar} maxInitials={1} className="mosaic-tile-avatar-mini" />
          <span className="mosaic-tile-name-text">{userName}</span>
          {elapsed && <span className="mosaic-tile-timer">{elapsed}</span>}
        </span>
      </div>
      <span className="mosaic-tile-actions">
        {hasStream && (
          <button
            className="mosaic-icon-btn"
            onClick={(e) => { e.stopPropagation(); toggleMute() }}
            title={muted ? t('unmuteStream') : t('muteStream')}
            aria-label={muted ? t('unmuteStream') : t('muteStream')}
          >
            {muted ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
        )}
        <FullscreenBtn videoRef={videoRef} isFullscreen={isFullscreen} />
        {focused && (
          <button
            className="mosaic-icon-btn mosaic-back-btn"
            onClick={(e) => { e.stopPropagation(); onBack() }}
            title={t('backToMosaic')}
            aria-label={t('backToMosaic')}
          >
            ✕
          </button>
        )}
      </span>
    </div>
  )
}

export function MultiLiveMosaic() {
  const t = useT()
  const myId = useConnectionStore((s) => s.id)
  const myName = useConnectionStore((s) => s.name)
  const currentRoomName = useRoomStore((s) => s.currentRoomName)
  const currentRoom = useRoomStore((s) => s.currentRoom)
  const users = useRoomStore((s) => s.users)
  const broadcasters = useLiveStore((s) => s.broadcasters)
  const videoRec = useVideoRecorder()
  const [starting, setStarting] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [isLandscape, setIsLandscape] = useState(false)
  const [autoFullscreen, setAutoFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)
  const myVideoRef = useRef<HTMLVideoElement>(null)
  const isFullscreen = useFullscreenState()
  const isMobile = isMobileDevice()

  const amBroadcasting = broadcasters.some((b) => b.userId === myId)
  const others = broadcasters.filter((b) => b.userId !== myId)
  const hasAnyLive = broadcasters.length > 0
  const me = broadcasters.find((b) => b.userId === myId)
  const myElapsed = useElapsed(me?.timestamp)
  const myAvatar = useRoomStore((s) => s.users.find((u) => u.id === myId)?.avatar)
  const myLevel = useStreamLevel(videoRec.streamRef.current)
  const mySpeaking = myLevel > 0.12
  const spectatorCount = users.filter((u) => u.room === currentRoom).length

  // Notificação quando alguém entra na live (ignora os já presentes ao entrar).
  const notifiedRef = useRef<Set<string> | null>(null)
  const graceUntilRef = useRef(Date.now() + 1500)
  useEffect(() => {
    if (!notifiedRef.current) {
      notifiedRef.current = new Set(broadcasters.map((b) => b.userId))
      return
    }
    for (const b of broadcasters) {
      if (b.userId === myId) continue
      if (notifiedRef.current.has(b.userId)) continue
      if (Date.now() < graceUntilRef.current) continue
      notifiedRef.current.add(b.userId)
      useToastStore.getState().show('info', t('liveJoinedToast', { name: b.userName }))
    }
  }, [broadcasters, myId])

  // Ao expandir um tile (foco), rola a página para centralizá-lo na tela.
  useEffect(() => {
    if (!focusedId) return
    const el = document.querySelector<HTMLElement>(`.mosaic-tile[data-user-id="${focusedId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusedId])

  // Preview da própria câmera (quando transmitindo).
  useEffect(() => {
    const el = myVideoRef.current
    if (!el || !videoRec.streamRef.current) return
    el.srcObject = videoRec.streamRef.current
    el.play().catch(() => {})
  }, [videoRec.streamVersion, amBroadcasting])

  // Inicia/para o WebRTC conforme meu estado de transmissão no servidor.
  useEffect(() => {
    if (amBroadcasting) {
      const stream = videoRec.streamRef.current
      if (!stream) return
      const usersList = useRoomStore.getState().users
      const roomId = useRoomStore.getState().currentRoom
      const viewerIds = usersList
        .filter((u) => u.id !== myId && u.room === roomId)
        .map((u) => u.id)
      liveRtc.startBroadcast(stream, viewerIds)
    } else {
      liveRtc.stopBroadcast()
    }
  }, [amBroadcasting, myId, videoRec.streamVersion])

  // Ao desmontar (saiu da sala), libera câmera e conexões WebRTC.
  useEffect(() => {
    return () => {
      liveRtc.stopBroadcast()
      liveRtc.stopViewing()
      videoRec.closeCamera()
    }
  }, [])

  // No mobile, girar o celular para paisagem com a live ligada entra
  // automaticamente em tela cheia (overlay via CSS, confiável mesmo onde o
  // Fullscreen API exige gesto do usuário); voltar para retrato sai.
  useEffect(() => {
    if (!isMobile) return
    const mql = window.matchMedia('(orientation: landscape)')
    const update = (e: MediaQueryList | MediaQueryListEvent) => setIsLandscape(e.matches)
    mql.addEventListener('change', update)
    update(mql)
    return () => mql.removeEventListener('change', update)
  }, [isMobile])

  useEffect(() => {
    setAutoFullscreen(isMobile && amBroadcasting && isLandscape)
  }, [isMobile, amBroadcasting, isLandscape])

  async function handleStart() {
    if (starting) return
    // getUserMedia exige contexto seguro (HTTPS ou localhost) + permissão.
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      useToastStore.getState().show('error', t('cameraUnavailable'))
      return
    }
    setStarting(true)
    try {
      if (videoRec.devices.length === 0) {
        await videoRec.enumerateDevices()
      }
      const ok = await videoRec.openCamera()
      if (!ok) {
        useToastStore.getState().show('error', t('cameraStartFailed'))
        return
      }
      sendLiveStart()
    } finally {
      setStarting(false)
    }
  }

  function handleStop() {
    liveRtc.stopBroadcast()
    sendLiveStop()
    setStarting(false)
  }

  // No mobile, girar a câmera = encerrar a live e abrir outra automaticamente
  // (mais confiável que trocar a track no meio; os espectadores veem a nova
  // câmera ao reconectar).
  async function handleFlip() {
    liveRtc.stopBroadcast()
    sendLiveStop()
    await videoRec.flipCamera()
    sendLiveStart()
  }

  function copyLiveLink() {
    getLiveViewerUrl().then((url) => {
      navigator.clipboard.writeText(url).then(() => {
        useToastStore.getState().show('success', t('linkCopied'))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(() => {
        useToastStore.getState().show('error', t('linkCopyError'))
      })
    })
  }

  return (
    <div className="multilive">
      <div className="multilive-header">
        <span className="multilive-title">#{currentRoomName}</span>
        <span className={`multilive-count${hasAnyLive ? ' multilive-count--live' : ''}`}>
          <span className="multilive-dot" />
          {t('multiliveCount', { n: broadcasters.length })}
        </span>
        <span className="multilive-spectators">👥 {t('multiliveSpectators', { n: spectatorCount })}</span>
        <span className="multilive-hint">{t('multiliveHint')}</span>
        <button
          className="multilive-copy-btn"
          onClick={copyLiveLink}
          title={t('copyLiveLink')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>{copied ? t('linkCopied') : t('copyLiveLink')}</span>
        </button>
      </div>

      <div className="multilive-body">
        {!hasAnyLive ? (
          <div className="mosaic-empty-state">
            <span className="mosaic-empty-icon">🎥</span>
            <span className="mosaic-empty-title">{t('multiliveEmpty')}</span>
            <span className="mosaic-empty-hint">{t('multiliveEmptyHint')}</span>
            <button className="btn btn-primary mosaic-cta" onClick={handleStart} disabled={starting}>
              {starting ? t('liveRequesting') : t('multiliveStart')}
            </button>
          </div>
        ) : (
          <>
            <div className="mosaic-grid">
              {amBroadcasting && (
                <div className={`mosaic-tile mosaic-tile--self${mySpeaking ? ' mosaic-tile--speaking' : ''}${autoFullscreen ? ' mosaic-tile--auto-fs' : ''}`}>
                  <video ref={myVideoRef} autoPlay playsInline muted className="mosaic-tile-video" />
                  <span className="mosaic-tile-badge">● {t('liveBadge')}</span>
                  <div className="mosaic-tile-bar">
                    <span className="mosaic-tile-bar-name">
                      <Avatar id={myId ?? ''} name={myName ?? ''} avatar={myAvatar} maxInitials={1} className="mosaic-tile-avatar-mini" />
                      <span className="mosaic-tile-name-text">{myName} ({t('you')})</span>
                      {myElapsed && <span className="mosaic-tile-timer">{myElapsed}</span>}
                    </span>
                    <div className="mosaic-tile-controls">
                      {videoRec.devices.length > 1 && (
                        <select
                          className="mosaic-cam-select"
                          value={videoRec.cameraId}
                          onChange={(e) => videoRec.switchCamera(e.target.value)}
                          title={t('chooseCamera')}
                          aria-label={t('chooseCamera')}
                        >
                          {videoRec.devices.map((d, i) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || t('cameraFallback', { id: i + 1 })}
                            </option>
                          ))}
                        </select>
                      )}
                      {isMobile && (
                        <button
                          className="mosaic-icon-btn mosaic-flip-btn"
                          onClick={() => void handleFlip()}
                          title={t('flipCamera')}
                          aria-label={t('flipCamera')}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 4v6h6" />
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                          </svg>
                        </button>
                      )}
                      <button className="btn btn-danger mosaic-stop-btn" onClick={handleStop}>
                        ⏹ {t('multiliveStop')}
                      </button>
                    </div>
                  </div>
                  <span className="mosaic-tile-actions">
                    {autoFullscreen && (
                      <button
                        className="mosaic-icon-btn"
                        onClick={() => setAutoFullscreen(false)}
                        title={t('backToMosaic')}
                        aria-label={t('backToMosaic')}
                      >
                        ✕
                      </button>
                    )}
                    <FullscreenBtn videoRef={myVideoRef} isFullscreen={isFullscreen} />
                  </span>
                </div>
              )}

              {others.map((b) => (
                <MosaicTile
                  key={b.userId}
                  userId={b.userId}
                  userName={b.userName}
                  timestamp={b.timestamp}
                  focused={focusedId === b.userId}
                  onFocus={() => setFocusedId((f) => (f === b.userId ? null : b.userId))}
                  onBack={() => setFocusedId(null)}
                />
              ))}
            </div>

            {!amBroadcasting && hasAnyLive && (
              <div className="mosaic-join-bar">
                <span className="mosaic-join-icon">📹</span>
                <div className="mosaic-join-text">
                  <span className="mosaic-join-title">{t('multiliveJoinTitle')}</span>
                  <span className="mosaic-join-hint">{t('multiliveJoinHint')}</span>
                </div>
                <button className="btn mosaic-start-live-btn" onClick={handleStart} disabled={starting}>
                  {starting ? t('liveRequesting') : `🎥 ${t('multiliveStart')}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
