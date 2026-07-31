import { useState, useRef, useCallback } from 'react'

export type MediaKind = 'audio' | 'video'

interface MediaRecorderResult {
  recording: boolean
  supported: boolean
  start: () => void
  stop: () => Promise<Blob> | null
  cancel: () => void
}

export function useMediaRecorder(kind: MediaKind): MediaRecorderResult {
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const supported = typeof MediaRecorder !== 'undefined'

  const start = useCallback(() => {
    if (!supported || recording) return
    const constraints = kind === 'audio' ? { audio: true } : { audio: true, video: true }
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((stream) => {
        streamRef.current = stream
        chunksRef.current = []
        const recorder = new MediaRecorder(stream)
        recorderRef.current = recorder
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
        }
        recorder.start()
        setRecording(true)
      })
      .catch(() => {
        streamRef.current = null
      })
  }, [kind, recording, supported])

  const stop = useCallback((): Promise<Blob> | null => {
    const recorder = recorderRef.current
    if (!recorder) return null
    setRecording(false)
    return new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        recorderRef.current = null
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: kind === 'audio' ? 'audio/webm' : 'video/webm' })
        chunksRef.current = []
        resolve(blob)
      }
      recorder.stop()
    })
  }, [kind])

  const cancel = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorder.onstop = null
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    chunksRef.current = []
    try { recorder.stop() } catch { /* ignore */ }
    setRecording(false)
  }, [])

  return { recording, supported, start, stop, cancel }
}
