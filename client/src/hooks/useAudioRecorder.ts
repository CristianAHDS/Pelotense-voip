import { useState, useRef, useCallback } from 'react'
import { getUserMediaWithMic } from '../utils/media.ts'

export function useAudioRecorder() {
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resolveRef = useRef<((value: { data: string; duration: number } | null) => void) | null>(null)
  const cancelledRef = useRef(false)

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
    setRecording(false)
    setDuration(0)
  }, [])

  const startRecording = useCallback((): Promise<{ data: string; duration: number } | null> => {
    return new Promise((resolve) => {
      getUserMediaWithMic(false, true)
        .then((stream) => {
          streamRef.current = stream
          chunksRef.current = []
          setDuration(0)

          const startTime = Date.now()
          timerRef.current = setInterval(() => {
            setDuration(Math.floor((Date.now() - startTime) / 1000))
          }, 1000)

          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm'

          const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
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
            const finalDuration = Math.floor((Date.now() - startTime) / 1000)
            const blob = new Blob(chunksRef.current, { type: mimeType })
            const reader = new FileReader()
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1]
              resolve({ data: base64, duration: finalDuration })
            }
            reader.readAsDataURL(blob)
          }

          recorder.onerror = () => {
            stopRecording()
            resolve(null)
          }

          recorder.start(100)
          setRecording(true)
          resolveRef.current = resolve
        })
        .catch(() => {
          resolve(null)
        })
    })
  }, [stopRecording])

  return { recording, duration, startRecording, stopRecording, cancelRecording }
}
