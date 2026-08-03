import React, { useRef, useEffect, useState } from 'react'
import { useLiveStore } from '../stores/liveStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useVideoRecorder } from '../hooks/useVideoRecorder.ts'
import * as liveRtc from '../services/liveRtc.ts'
import { sendLiveStart, sendLiveStop } from '../services/connectionService.ts'
import { attachMediaStream } from '../audio/audioMeter.ts'
import { initials } from '../ui/avatar.ts'
import { isMobileDevice } from '../utils/device.ts'
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
      className="mosaic-fullscreen-btn"
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

// Azulejo de um transmissor (que não seja eu): abre um RTCPeerConnection e
// mostra a câmera ao vivo dele, com placeholder enquanto o stream não chega.
function MosaicTile({ userId, userName }: { userId: string; userName: string }) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasStream, setHasStream] = useState(false)
  const isFullscreen = useFullscreenState()

  useEffect(() => {
    setHasStream(false)
    const unsubscribe = liveRtc.startViewing(userId, (stream) => {
      const el = videoRef.current
      if (!el || !stream) return
      el.srcObject = stream
      attachMediaStream(stream, 'live', el)
      el.play().catch(() => {})
      setHasStream(true)
    })
    return () => {
      unsubscribe()
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [userId])

  return (
    <div className="mosaic-tile">
      <video ref={videoRef} autoPlay playsInline className="mosaic-tile-video" />
      {!hasStream && (
        <div className="mosaic-tile-placeholder">
          <span className="mosaic-tile-avatar">{initials(userName)}</span>
          <span className="mosaic-tile-spinner" />
          <span className="mosaic-tile-placeholder-name">{userName}</span>
        </div>
      )}
      <span className="mosaic-tile-badge">● {t('liveBadge')}</span>
      <span className="mosaic-tile-name">{userName}</span>
      <FullscreenBtn videoRef={videoRef} isFullscreen={isFullscreen} />
    </div>
  )
}

export function MultiLiveMosaic() {
  const t = useT()
  const myId = useConnectionStore((s) => s.id)
  const myName = useConnectionStore((s) => s.name)
  const currentRoomName = useRoomStore((s) => s.currentRoomName)
  const broadcasters = useLiveStore((s) => s.broadcasters)
  const videoRec = useVideoRecorder()
  const [starting, setStarting] = useState(false)
  const myVideoRef = useRef<HTMLVideoElement>(null)
  const isFullscreen = useFullscreenState()
  const isMobile = isMobileDevice()

  const amBroadcasting = broadcasters.some((b) => b.userId === myId)
  const others = broadcasters.filter((b) => b.userId !== myId)
  const hasAnyLive = broadcasters.length > 0

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
      const users = useRoomStore.getState().users
      const roomId = useRoomStore.getState().currentRoom
      const viewerIds = users
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

  async function handleStart() {
    if (starting) return
    setStarting(true)
    try {
      if (videoRec.devices.length === 0) {
        await videoRec.enumerateDevices()
      }
      const ok = await videoRec.openCamera()
      if (!ok) return
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

  return (
    <div className="multilive">
      <div className="multilive-header">
        <span className="multilive-title">#{currentRoomName}</span>
        <span className={`multilive-count${hasAnyLive ? ' multilive-count--live' : ''}`}>
          <span className="multilive-dot" />
          {t('multiliveCount', { n: broadcasters.length })}
        </span>
        <span className="multilive-hint">{t('multiliveHint')}</span>
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
                <div className="mosaic-tile mosaic-tile--self">
                  <video ref={myVideoRef} autoPlay playsInline muted className="mosaic-tile-video" />
                  <span className="mosaic-tile-badge">● {t('liveBadge')}</span>
                  <div className="mosaic-tile-bar">
                    <span className="mosaic-tile-bar-name">{myName} ({t('you')})</span>
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
                          className="mosaic-flip-btn"
                          onClick={() => void videoRec.flipCamera()}
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
                  <FullscreenBtn videoRef={myVideoRef} isFullscreen={isFullscreen} />
                </div>
              )}

              {others.map((b) => (
                <MosaicTile key={b.userId} userId={b.userId} userName={b.userName} />
              ))}
            </div>

            {!amBroadcasting && (
              <div className="mosaic-join-bar">
                <span className="mosaic-join-text">{t('multiliveJoinHint')}</span>
                <button className="btn btn-primary btn-sm" onClick={handleStart} disabled={starting}>
                  {starting ? t('liveRequesting') : t('multiliveStart')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
