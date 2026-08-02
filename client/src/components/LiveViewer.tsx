import React, { useRef, useEffect, useState } from 'react'
import { useLiveStore } from '../stores/liveStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import * as liveRtc from '../services/liveRtc.ts'
import { attachMediaStream, markActive } from '../audio/audioMeter.ts'
import { useT } from '../i18n/index.ts'

export function LiveViewer() {
  const broadcaster = useLiveStore((s) => s.broadcaster)
  const myId = useConnectionStore((s) => s.id)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const t = useT()

  function attachStream(stream: MediaStream | null) {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    if (stream) {
      // VU reage ao áudio da live: roteia pelo medidor e silencia o elemento.
      attachMediaStream(stream, 'live', video)
      video.play().catch(() => {
        // Autoplay com áudio pode ser bloqueado: retoma no primeiro gesto.
        const onGesture = () => {
          document.removeEventListener('pointerdown', onGesture)
          video.play().catch(() => {})
        }
        document.addEventListener('pointerdown', onGesture, { once: true })
      })
    } else {
      markActive('live', false)
    }
  }

  // Inicia/para a conexão WebRTC conforme a live. Vários LiveViewers do mesmo
  // transmissor (chat + tela cheia) compartilham a mesma conexão.
  useEffect(() => {
    if (!broadcaster || broadcaster.userId === myId) {
      liveRtc.stopViewing(broadcaster?.userId)
      return
    }
    const unsubscribe = liveRtc.startViewing(broadcaster.userId, attachStream)
    return () => {
      unsubscribe()
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [broadcaster?.userId])

  // Sincroniza o estado de fullscreen quando o usuário sai (Esc) ou muda.
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function toggleFullscreen() {
    const video = videoRef.current
    if (!video) return
    if (!document.fullscreenElement) {
      const req = (video.requestFullscreen ?? (video as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen)
      req?.call(video).then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      const exit = document.exitFullscreen ?? (document as unknown as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen
      exit?.call(document).then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  if (!broadcaster || broadcaster.userId === myId) return null

  return (
    <div className="live-viewer">
      <div className="live-viewer-header">
        <span className="live-viewer-indicator" />
        <span className="live-viewer-name">{broadcaster.userName}</span>
        <span className="live-viewer-label">LIVE</span>
        <button
          className="live-viewer-fullscreen-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? t('closeFullscreen') : t('chatFullscreen')}
          aria-label={isFullscreen ? t('closeFullscreen') : t('chatFullscreen')}
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
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="live-viewer-video"
      />
    </div>
  )
}
