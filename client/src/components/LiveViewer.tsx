import React, { useRef, useEffect, useState } from 'react'
import { useLiveStore } from '../stores/liveStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'

const MAX_CHUNKS = 200
const REVOKE_DELAY = 3000

function isMseSupported(mimeType: string): boolean {
  try {
    return MediaSource && MediaSource.isTypeSupported(mimeType)
  } catch {
    return false
  }
}

function chunkToBuffer(chunk: string): Uint8Array {
  try {
    const binary = atob(chunk)
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  } catch {
    return new Uint8Array()
  }
}

const MSE_MIMES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

function findSupportedMime(): string | null {
  for (const mime of MSE_MIMES) {
    if (isMseSupported(mime)) return mime
  }
  return null
}

export function LiveViewer() {
  const broadcaster = useLiveStore((s) => s.broadcaster)
  const chunks = useLiveStore((s) => s.chunks)
  const myId = useConnectionStore((s) => s.id)
  const videoRef = useRef<HTMLVideoElement>(null)
  const blobUrlRef = useRef<string | null>(null)
  const prevChunkCount = useRef(0)
  const mediaSourceRef = useRef<MediaSource | null>(null)
  const sourceBufferRef = useRef<SourceBuffer | null>(null)
  const pendingRef = useRef<Uint8Array[]>([])
  const appendingRef = useRef(false)
  const pendingUrlsRef = useRef<string[]>([])
  const [, forceUpdate] = useState(0)
  const useMse = useRef(false)

  function flushPending() {
    const sb = sourceBufferRef.current
    if (!sb || appendingRef.current || pendingRef.current.length === 0) return
    appendingRef.current = true
    const data = pendingRef.current.shift()!
    try { sb.appendBuffer(data.buffer as ArrayBuffer) } catch { appendingRef.current = false }
  }

  function updateBlobVideoSource() {
    const video = videoRef.current
    const url = blobUrlRef.current
    if (!video || !url) return
    video.src = url
    video.play().catch(() => {})
  }

  // Init MSE-based stream
  useEffect(() => {
    if (!broadcaster) return

    useMse.current = findSupportedMime() !== null
    if (!useMse.current) return

    const video = videoRef.current
    if (!video) return

    const ms = new MediaSource()
    mediaSourceRef.current = ms

    ms.addEventListener('sourceopen', () => {
      const mime = findSupportedMime()
      if (!mime) return
      try {
        const sb = ms.addSourceBuffer(mime)
        sourceBufferRef.current = sb
        sb.addEventListener('updateend', () => {
          appendingRef.current = false
          flushPending()
        })
        flushPending()
      } catch { /* MSE failed */ }
    })

    const url = URL.createObjectURL(ms)
    blobUrlRef.current = url
    video.src = url
    video.play().catch(() => {})

    return () => {
      if (ms.readyState === 'open') { try { ms.endOfStream() } catch { /* ignore */ } }
      URL.revokeObjectURL(url)
      mediaSourceRef.current = null
      sourceBufferRef.current = null
      pendingRef.current = []
      appendingRef.current = false
      prevChunkCount.current = 0
    }
  }, [broadcaster?.userId])

  // Init blob-based stream (fallback when MSE unsupported)
  useEffect(() => {
    if (!broadcaster || useMse.current) return

    const video = videoRef.current
    if (!video) return

    video.addEventListener('error', () => {
      const url = blobUrlRef.current
      if (!url) return
      video.src = ''
      video.load()
      setTimeout(() => {
        if (blobUrlRef.current === url) {
          video.src = url
          video.play().catch(() => {})
        }
      }, 100)
    })
  }, [broadcaster?.userId])

  // Cleanup on broadcaster stop
  useEffect(() => {
    if (broadcaster) return
    blobUrlRef.current = null
    prevChunkCount.current = 0
    pendingUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    pendingUrlsRef.current = []
    mediaSourceRef.current = null
    sourceBufferRef.current = null
    pendingRef.current = []
    appendingRef.current = false
    forceUpdate((n) => n + 1)
  }, [broadcaster])

  // Append chunks
  useEffect(() => {
    const count = chunks.length
    if (count <= prevChunkCount.current) return
    const start = prevChunkCount.current
    prevChunkCount.current = count

    if (useMse.current) {
      // MSE path: append to SourceBuffer
      for (let i = start; i < count; i++) {
        const c = chunks[i]
        if (!c.chunk || typeof c.chunk !== 'string') continue
        try {
          const binary = atob(c.chunk)
          pendingRef.current.push(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)))
        } catch { /* skip */ }
      }
      flushPending()
    } else {
      // Blob path: rebuild blob with latest chunks, delayed revoke
      const video = videoRef.current
      if (!video) return
      const relevant = chunks.slice(-MAX_CHUNKS)
      const buffers: BlobPart[] = relevant
        .filter((c) => c.chunk && typeof c.chunk === 'string')
        .map((c) => chunkToBuffer(c.chunk).buffer as ArrayBuffer)
      const blob = new Blob(buffers, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const oldUrl = blobUrlRef.current
      blobUrlRef.current = url
      updateBlobVideoSource()
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
    }
  }, [chunks])

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
      />
    </div>
  )
}
