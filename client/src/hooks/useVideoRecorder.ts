import { useState, useRef, useCallback } from 'react'
import * as liveRtc from '../services/liveRtc.ts'
import { getUserMediaWithMic } from '../utils/media.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { tStatic } from '../i18n/index.ts'

interface VideoDevice {
  deviceId: string
  label: string
}

function videoSettings() {
  return useConnectionStore.getState().settings
}

function videoConstraints(deviceId?: string): MediaTrackConstraints {
  const v = videoSettings().video
  const c: MediaTrackConstraints = {
    width: { ideal: v.width },
    height: { ideal: v.height },
    frameRate: { ideal: v.fps },
  }
  if (deviceId) {
    ;(c as MediaTrackConstraints & { deviceId: { exact: string } }).deviceId = { exact: deviceId }
  }
  return c
}

function createRecorder(stream: MediaStream, mimeType: string): MediaRecorder {
  const bitrate = videoSettings().video.bitrate
  try {
    return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate })
  } catch {
    try {
      return new MediaRecorder(stream, { mimeType })
    } catch {
      return new MediaRecorder(stream)
    }
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
    const maxBytes = videoSettings().maxVideoBytes
    const maxBase64 = Math.ceil((maxBytes * 4) / 3) + 4
    if (!base64 || base64.length > maxBase64) {
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

// Espera o track de vídeo de uma stream ficar realmente ativo (live e não
// muted). No mobile, ao trocar de câmera o track novo pode nascer "mudo"
// (vídeo congelado); substituir a track WebRTC antes disso congela a live
// para quem assiste, mesmo com o preview local normal.
function waitForVideoTrack(stream: MediaStream, timeoutMs = 3000): Promise<boolean> {
  const track = stream.getVideoTracks()[0]
  if (!track) return Promise.resolve(false)
  if (track.readyState === 'live' && !track.muted) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(track.readyState === 'live' && !track.muted), timeoutMs)
    track.addEventListener('unmute', () => {
      clearTimeout(timeout)
      resolve(track.readyState === 'live')
    }, { once: true })
  })
}

export function useVideoRecorder() {
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [hasStream, setHasStream] = useState(false)
  const [streamVersion, setStreamVersion] = useState(0)
  const [devices, setDevices] = useState<VideoDevice[]>([])
  const [cameraId, setCameraId] = useState<string>('')
  // Câmera frontal/traseira (mobile): alternativa ao seletor por deviceId.
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
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
        .map((d) => ({ deviceId: d.deviceId, label: d.label || tStatic('cameraFallback', { id: d.deviceId.slice(0, 8) }) }))
      setDevices(video)
      if (video.length > 0 && !cameraId) {
        setCameraId(video[0].deviceId)
      }
    } catch {
      // silently fail
    }
  }, [cameraId])

  const switchCamera = useCallback(async (newCameraId: string) => {
    const oldStream = streamRef.current
    if (!oldStream) return

    try {
      const newStream = await getUserMediaWithMic(videoConstraints(newCameraId), true)

      // Só troca quando a nova câmera estiver entregando frames (no mobile ela
      // pode nascer "muda"); trocar antes congela a live para os espectadores.
      const ready = await waitForVideoTrack(newStream)
      if (!ready) {
        newStream.getTracks().forEach((t) => t.stop())
        return
      }
      setCameraId(newCameraId)

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

  // Alterna entre câmera frontal/traseira (mobile) via facingMode, sem depender
  // da enumeração de deviceIds. Funciona mesmo quando o navegador reporta só
  // uma câmera; troca o stream na hora (e na live, via replaceStream).
  const flipCamera = useCallback(async (): Promise<boolean> => {
    const next = facingMode === 'user' ? 'environment' : 'user'
    const v = videoSettings().video
    const constraints: MediaTrackConstraints = {
      width: { ideal: v.width },
      height: { ideal: v.height },
      frameRate: { ideal: v.fps },
      facingMode: { ideal: next },
    }
    try {
      // Só VÍDEO na troca: no mobile, pedir áudio de novo é lento ou falha
      // enquanto o microfone já está capturado (pela live/room voice). A track
      // de áudio atual é reutilizada; só o vídeo muda.
      const newVideo = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false })
      const track = newVideo.getVideoTracks()[0]
      if (!track) {
        newVideo.getTracks().forEach((t) => t.stop())
        return false
      }

      // Espera curta para a track destravar; mesmo que demore, faz a troca
      // (o vídeo pode congelar por um instante, mas o flip acontece — em vez de
      // ficar travado na câmera antiga).
      await waitForVideoTrack(newVideo, 1500).catch(() => false)

      const old = streamRef.current
      const audioTrack = old?.getAudioTracks()[0]
      const combined = new MediaStream(track ? [track] : [])
      if (audioTrack) combined.addTrack(audioTrack)

      // Para só a track de vídeo antiga; mantém a de áudio (reutilizada).
      if (old) old.getVideoTracks().forEach((t) => t.stop())

      streamRef.current = combined
      setFacingMode(next)
      setHasStream(true)
      setStreamVersion((s) => s + 1)
      // Renegociação (novo offer) no mobile: replaceTrack congela o vídeo
      // para os espectadores no iOS.
      liveRtc.renegotiateStream(combined)
      return true
    } catch {
      return false
    }
  }, [facingMode])

  // No mobile (iOS), após parar uma live longa a câmera demora a ser liberada
  // pelo hardware; pedir getUserMedia de novo na hora pode falhar ou voltar com
  // o track ainda "mudo" (vídeo preto). Então: (1) tenta de novo com um delay
  // curto se a aquisição falhar e (2) espera o track de vídeo ficar realmente
  // ativo (live e não muted) antes de considerar a câmera pronta.
  const openCamera = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 500))
      }
      let s: MediaStream | null = null
      try {
        s = await getUserMediaWithMic(videoConstraints(cameraId), true)
      } catch {
        continue
      }
      if (!s) continue
      const track = s.getVideoTracks()[0]
      if (!track) {
        // Sem track de vídeo (ex: câmera indisponível): não marca como pronta.
        s.getTracks().forEach((t) => t.stop())
        continue
      }
      if (track.readyState === 'live' && !track.muted) {
        streamRef.current = s
        setHasStream(true)
        setStreamVersion((v) => v + 1)
        return true
      }
      // Track ainda inicializando (iOS): espera destravar.
      const ok = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(track.readyState === 'live' && !track.muted), 1500)
        track.addEventListener('unmute', () => {
          clearTimeout(timeout)
          resolve(track.readyState === 'live')
        }, { once: true })
      })
      if (ok) {
        streamRef.current = s
        setHasStream(true)
        setStreamVersion((v) => v + 1)
        return true
      }
      s.getTracks().forEach((t) => t.stop())
    }
    return false
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
    enumerateDevices, switchCamera, flipCamera,
  }
}
