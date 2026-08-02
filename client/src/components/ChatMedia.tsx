import React, { useEffect, useMemo, useRef, useState } from 'react'
import { tStatic } from '../i18n/index.ts'
import { downloadAudioAsWav, audioMessageFilename } from '../utils/download.ts'
import { attachMediaElement } from '../audio/audioMeter.ts'

const RATES = [0.5, 1, 1.5, 2]

export function ChatMedia({ audioData, videoData, imageData, duration, userName, timestamp, onLightbox, mime }: {
  audioData?: string
  videoData?: string
  imageData?: string
  duration?: number
  userName: string
  timestamp: number
  onLightbox?: (src: string) => void
  mime?: string
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [dur, setDur] = useState(duration ?? 0)
  const [seeking, setSeeking] = useState(false)
  const [rate, setRate] = useState(1)

  // Alturas das barras da onda: determinísticas por mensagem, para não
  // "tremeluzir" a cada atualização de currentTime (timeupdate).
  const bars = useMemo(
    () => Array.from({ length: 32 }, (_, i) => 20 + Math.sin(i * 0.8) * 30 + ((i * 37) % 10)),
    []
  )

  useEffect(() => {
    if (audioData && !audioUrl) {
      const url = URL.createObjectURL(
        new Blob(
          [Uint8Array.from(atob(audioData), (c) => c.charCodeAt(0))],
          { type: mime ?? 'audio/webm' }
        )
      )
      setAudioUrl(url)
    }
    if (videoData && !videoUrl) {
      const url = URL.createObjectURL(
        new Blob(
          [Uint8Array.from(atob(videoData), (c) => c.charCodeAt(0))],
          { type: mime ?? 'video/webm' }
        )
      )
      setVideoUrl(url)
    }
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
  }, [audioData, videoData])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate])

  // Roteia o elemento pelo medidor de nível (VU reage ao reproduzir a mídia).
  useEffect(() => {
    if (audioRef.current) attachMediaElement(audioRef.current, 'media-audio')
    if (videoRef.current) attachMediaElement(videoRef.current, 'media-video')
  }, [audioUrl, videoUrl])

  function togglePlay() {
    if (!audioRef.current) return
    if (playing) {
      audioRef.current.pause()
    } else {
      audioRef.current.playbackRate = rate
      audioRef.current.play()
    }
  }

  function cycleRate() {
    setRate((r) => {
      const next = RATES[(RATES.indexOf(r) + 1) % RATES.length]
      if (audioRef.current) audioRef.current.playbackRate = next
      return next
    })
  }

  const totalDuration =
    audioRef.current?.duration && isFinite(audioRef.current.duration)
      ? audioRef.current.duration
      : dur

  const progress = totalDuration > 0 ? Math.min(1, Math.max(0, currentTime / totalDuration)) : 0

  function seekFromClientX(clientX: number) {
    if (!audioRef.current || !progressRef.current) return
    const rect = progressRef.current.getBoundingClientRect()
    if (rect.width === 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const target = ratio * totalDuration
    audioRef.current.currentTime = target
    setCurrentTime(target)
  }

  function seekBy(delta: number) {
    if (!audioRef.current) return
    const next = Math.min(totalDuration, Math.max(0, audioRef.current.currentTime + delta))
    audioRef.current.currentTime = next
    setCurrentTime(next)
  }

  function handleSeekKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      seekBy(5)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      seekBy(-5)
    }
  }

  function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(seconds))
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  if (videoData) {
    return (
      <div className="chat-bubble-video">
        {videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className="chat-video-player"
          />
        )}
        <div className="chat-bubble-time">{formatDuration(duration ?? 0)}</div>
      </div>
    )
  }

  if (imageData) {
    return (
      <div className="chat-bubble-image">
        <img
          src={`data:image/jpeg;base64,${imageData}`}
          className="chat-image"
          alt=""
          onClick={() => onLightbox?.(`data:image/jpeg;base64,${imageData}`)}
        />
      </div>
    )
  }

  if (!audioData) return null

  return (
    <div className="chat-bubble-audio">
      <div className="chat-audio-controls">
        <button
          onClick={togglePlay}
          className="chat-audio-play-btn"
          title={playing ? tStatic('audioPause') : tStatic('audioPlay')}
        >
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>
        <button
          onClick={cycleRate}
          className="chat-audio-rate-btn"
          title={tStatic('speed')}
        >
          {rate}x
        </button>
        <button
          onClick={() => {
            void downloadAudioAsWav(audioData, audioMessageFilename(userName, timestamp, 'wav'))
          }}
          className="chat-audio-download-btn"
          title={tStatic('download')}
          aria-label={tStatic('download')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>
      <div
        ref={progressRef}
        className="chat-audio-progress"
        role="slider"
        aria-label="Linha do tempo do áudio"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalDuration)}
        aria-valuenow={Math.round(currentTime)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault()
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          setSeeking(true)
          seekFromClientX(e.clientX)
        }}
        onPointerMove={(e) => {
          if (seeking) seekFromClientX(e.clientX)
        }}
        onPointerUp={() => setSeeking(false)}
        onPointerCancel={() => setSeeking(false)}
        onPointerLeave={() => setSeeking(false)}
        onKeyDown={handleSeekKey}
      >
        <div className="chat-audio-track">
          <div
            className="chat-audio-fill"
            style={{ width: `${progress * 100}%` }}
          />
          <div
            className="chat-audio-thumb"
            style={{ left: `calc(${progress * 100}% - 5px)` }}
          />
        </div>
        <div className="chat-audio-wave">
          {bars.map((h, i) => (
            <div
              key={i}
              className={`chat-audio-bar ${(i + 1) / bars.length <= progress ? 'chat-audio-bar--active' : ''}`}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <div className="chat-audio-time-row">
          <span className="chat-audio-time">{formatDuration(currentTime)}</span>
          <span className="chat-audio-duration">{formatDuration(dur)}</span>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
            setDur(e.currentTarget.duration)
          }
        }}
        onEnded={() => {
          setPlaying(false)
          setCurrentTime(0)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
    </div>
  )
}
