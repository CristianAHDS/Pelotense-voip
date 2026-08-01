import { useState, useRef, useCallback } from 'react'
import * as liveRtc from '../services/liveRtc.ts'
import { getUserMediaWithMic } from '../utils/media.ts'

interface VideoDevice {
  deviceId: string
  label: string
}

// Espelha DEFAULT_SECURITY_LIMITS.maxVideoMessageBytes (5MB) do servidor, que é
// o limite real de descarte (o servidor continua sendo a autoridade). O guarda
// aqui evita que um vídeo grande demais seja enviado e descartado em silêncio.
const MAX_VIDEO_MESSAGE_BYTES = 5 * 1024 * 1024
const MAX_VIDEO_BASE64_LENGTH = Math.ceil((MAX_VIDEO_MESSAGE_BYTES * 4) / 3) + 4
const VIDEO_BITS_PER_SECOND = 500_000

function createRecorder(stream: MediaStream, mimeType: string): MediaRecorder {
  try {
    return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND })
  } catch {
    return new MediaRecorder(stream, { mimeType })
  }
}

function readBlobResult(
  blob: Blob,
  finalDuration: number,
  resolve: (value: VideoRecordingResult) => void,
): void {
  const reader = new FileReader()
  reader.onloadend = () => {
    const base64 = (reader.result as string).split(',')[1]
    if (base64.length > MAX_VIDEO_BASE64_LENGTH) {
      resolve({ error: 'too-large' })
      return
    }
    resolve({ data: base64, duration: finalDuration })
  }
  reader.readAsDataURL(blob)
}

export type VideoRecordingResult =
  | { data: string; duration: number }
  | { error: 'too-large' }
  | null

export function useVideoRecorder() {
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [hasStream, setHasStream] = useState(false)
  const [streamVersion, setStreamVersion] = useState(0)
  const [devices, setDevices] = useState<VideoDevice[]>([])
  const [cameraId, setCameraId] = useState<string>('')
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resolveRef = useRef<((value: VideoRecordingResult) => void) | null>(null)
  const cancelledRef = useRef(false)
  const startTimeRef = useRef(0)
  const mimeTypeRef = useRef('video/webm')

  const stopRecording = useCallback(() => {
    cancelledRef.current = false
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setHasStream(false)
    setRecording(false)
    setDuration(0)
  }, [])

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setHasStream(false)
    setRecording(false)
    setDuration(0)
  }, [])

  const enumerateDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const video = all
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 8)}` }))
      setDevices(video)
      if (video.length > 0 && !cameraId) {
        setCameraId(video[0].deviceId)
      }
    } catch {
      // silently fail
    }
  }, [cameraId])

  const switchCamera = useCallback(async (newCameraId: string) => {
    setCameraId(newCameraId)
    const oldStream = streamRef.current
    if (!oldStream) return

    try {
      const newStream = await getUserMediaWithMic(
        { deviceId: { exact: newCameraId }, width: { ideal: 640 }, height: { ideal: 480 } },
        true,
      )

      const wasRecording = recorderRef.current?.state === 'recording'

      if (wasRecording) {
        const oldRecorder = recorderRef.current
        oldRecorder!.ondataavailable = () => {}
        oldRecorder!.onstop = () => {}
        oldRecorder!.stop()
      }

      oldStream.getTracks().forEach((t) => t.stop())

      streamRef.current = newStream
      setStreamVersion((v) => v + 1)

      // Se estiver transmitindo ao vivo, troca as tracks do WebRTC sem cair a live.
      liveRtc.replaceStream(newStream)

      if (wasRecording) {
        const resolve = resolveRef.current!
        const mimeType = mimeTypeRef.current
        const recorder = createRecorder(newStream, mimeType)
        recorderRef.current = recorder

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }

        recorder.onstop = () => {
          if (cancelledRef.current) {
            cancelledRef.current = false
            resolve(null)
            return
          }
          const finalDuration = Math.floor((Date.now() - startTimeRef.current) / 1000)
          const blob = new Blob(chunksRef.current, { type: mimeType })
          readBlobResult(blob, finalDuration, resolve)
        }

        recorder.onerror = () => {
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          setRecording(false)
          resolve(null)
        }

        recorder.start(100)
      }
    } catch {
      // camera switch failed, keep old camera
    }
  }, [])

  const openCamera = useCallback(async (): Promise<boolean> => {
    try {
      const videoConstraints: MediaTrackConstraints = cameraId
        ? { deviceId: { exact: cameraId }, width: { ideal: 640 }, height: { ideal: 480 } }
        : { width: { ideal: 640 }, height: { ideal: 480 } }
      const s = await getUserMediaWithMic(videoConstraints, true)
      streamRef.current = s
      setHasStream(true)
      setStreamVersion((v) => v + 1)
      return true
    } catch {
      return false
    }
  }, [cameraId])

  const beginRecording = useCallback((): Promise<VideoRecordingResult> => {
    return new Promise((resolve) => {
      const s = streamRef.current
      if (!s) {
        resolve(null)
        return
      }

      resolveRef.current = resolve
      chunksRef.current = []
      setDuration(0)

      startTimeRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
          ? 'video/webm;codecs=vp8'
          : 'video/webm'
      mimeTypeRef.current = mimeType

      const recorder = createRecorder(s, mimeType)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        if (cancelledRef.current) {
          cancelledRef.current = false
          resolve(null)
          return
        }
        const finalDuration = Math.floor((Date.now() - startTimeRef.current) / 1000)
        const blob = new Blob(chunksRef.current, { type: mimeType })
        readBlobResult(blob, finalDuration, resolve)
      }

      recorder.onerror = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setRecording(false)
        resolve(null)
      }

      recorder.start(100)
      setRecording(true)
    })
  }, [])

  const closeCamera = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setHasStream(false)
    setRecording(false)
    setDuration(0)
  }, [])

  return {
    recording, duration, hasStream, streamVersion, streamRef,
    devices, cameraId, setCameraId,
    openCamera, beginRecording, stopRecording, cancelRecording, closeCamera,
    enumerateDevices, switchCamera,
  }
}
