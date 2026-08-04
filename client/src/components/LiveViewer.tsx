import React, { useRef, useEffect, useState } from 'react'
import { useLiveStore } from '../stores/liveStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import * as liveRtc from '../services/liveRtc.ts'
import { attachMediaStream, markActive } from '../audio/audioMeter.ts'
import { useT } from '../i18n/index.ts'
import { useToastStore } from '../stores/toastStore.ts'

export function LiveViewer({ minimal }: { minimal?: boolean }) {
  const broadcaster = useLiveStore((s) => s.broadcasters[0])
  const myId = useConnectionStore((s) => s.id)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)
  const t = useT()

  function attachStream(stream: MediaStream | null) {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    if (stream) {
      attachMediaStream(stream, 'live', video)
      video.play().catch(() => {
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

  function copyLiveLink() {
    if (!broadcaster) return
    const host = window.location.hostname
    const url = `${window.location.protocol}//${host}/viewer?host=${host}&port=3003&room=Ao%20vivo`
    navigator.clipboard.writeText(url).then(() => {
      useToastStore.getState().show('success', t('linkCopied'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      useToastStore.getState().show('error', t('linkCopyError'))
    })
  }

  if (!broadcaster || broadcaster.userId === myId) return null

  if (minimal) {
    return (
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="viewer-video"
      />
    )
  }

  return (
    <div className="live-viewer">
      <div className="live-viewer-header">
        <div className="live-viewer-header-left">
          <span className="live-viewer-indicator" />
          <span className="live-viewer-name">{broadcaster.userName}</span>
          <span className="live-viewer-label">{t('liveBadge')}</span>
        </div>
        <div className="live-viewer-header-right">
          <button
            className="live-viewer-copy-btn"
            onClick={copyLiveLink}
            title={t('copyLiveLink')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>{copied ? t('linkCopied') : t('copyLiveLink')}</span>
          </button>
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
