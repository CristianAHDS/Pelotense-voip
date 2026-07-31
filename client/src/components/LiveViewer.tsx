import React, { useRef, useEffect, useState } from 'react'
import { useLiveStore } from '../stores/liveStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'

const MAX_CHUNKS = 200
const REVOKE_DELAY = 3000

function chunkToBuffer(chunk: string): Uint8Array {
  try {
    const binary = atob(chunk)
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  } catch {
    return new Uint8Array()
  }
}

export function LiveViewer() {
  const broadcaster = useLiveStore((s) => s.broadcaster)
  const chunks = useLiveStore((s) => s.chunks)
  const myId = useConnectionStore((s) => s.id)
  const videoRef = useRef<HTMLVideoElement>(null)
  const blobUrlRef = useRef<string | null>(null)
  const prevChunkCount = useRef(0)
  const pendingUrlsRef = useRef<string[]>([])
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, forceUpdate] = useState(0)

  function updateVideoSource() {
    const video = videoRef.current
    const url = blobUrlRef.current
    if (!video || !url) return
    video.src = url
    video.play().catch(() => {})
  }

  function handleVideoError() {
    if (retryTimerRef.current) return
    const video = videoRef.current
    if (!video) return
    video.src = ''
    video.load()
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      const url = blobUrlRef.current
      if (url) {
        video.src = url
        video.play().catch(() => {})
      }
    }, 300)
  }

  useEffect(() => {
    if (!broadcaster) return
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }
  }, [broadcaster?.userId])

  useEffect(() => {
    if (chunks.length <= prevChunkCount.current) return
    prevChunkCount.current = chunks.length

    const relevant = chunks.slice(-MAX_CHUNKS)
    const buffers: BlobPart[] = relevant
      .filter((c) => c.chunk && typeof c.chunk === 'string')
      .map((c) => chunkToBuffer(c.chunk).buffer as ArrayBuffer)
    const blob = new Blob(buffers, { type: 'video/webm' })
    const url = URL.createObjectURL(blob)

    const oldUrl = blobUrlRef.current
    blobUrlRef.current = url
    updateVideoSource()

    if (oldUrl) {
      pendingUrlsRef.current.push(oldUrl)
      setTimeout(() => {
        const idx = pendingUrlsRef.current.indexOf(oldUrl)
        if (idx !== -1) {
          pendingUrlsRef.current.splice(idx, 1)
          URL.revokeObjectURL(oldUrl)
        }
      }, REVOKE_DELAY)
    }
  }, [chunks])

  useEffect(() => {
    if (!broadcaster) {
      blobUrlRef.current = null
      prevChunkCount.current = 0
      pendingUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      pendingUrlsRef.current = []
      forceUpdate((n) => n + 1)
    }
  }, [broadcaster])

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
      pendingUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      pendingUrlsRef.current = []
    }
  }, [])

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
        onError={handleVideoError}
      />
    </div>
  )
}
