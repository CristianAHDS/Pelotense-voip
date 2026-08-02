import React, { useRef, useEffect } from 'react'
import { useLiveStore } from '../stores/liveStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import * as liveRtc from '../services/liveRtc.ts'
import { attachMediaStream, markActive } from '../audio/audioMeter.ts'

export function LiveViewer() {
  const broadcaster = useLiveStore((s) => s.broadcaster)
  const myId = useConnectionStore((s) => s.id)
  const videoRef = useRef<HTMLVideoElement>(null)

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

  if (!broadcaster || broadcaster.userId === myId) return null

  return (
    <div className="live-viewer">
      <div className="live-viewer-header">
        <span className="live-viewer-indicator" />
        <span className="live-viewer-name">{broadcaster.userName}</span>
        <span className="live-viewer-label">LIVE</span>
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
