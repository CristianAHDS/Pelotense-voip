import { useState, useRef, useCallback } from 'react'

interface VideoDevice {
  deviceId: string
  label: string
}

export function useVideoRecorder() {
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [hasStream, setHasStream] = useState(false)
  const [devices, setDevices] = useState<VideoDevice[]>([])
  const [cameraId, setCameraId] = useState<string>('')
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resolveRef = useRef<((value: { data: string; duration: number } | null) => void) | null>(null)
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
    const currentStream = streamRef.current
    if (!currentStream) return

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: newCameraId } },
        audio: true,
      })

      const oldVideoTrack = currentStream.getVideoTracks()[0]
      const newVideoTrack = newStream.getVideoTracks()[0]

      if (oldVideoTrack) {
        currentStream.removeTrack(oldVideoTrack)
        oldVideoTrack.stop()
      }
      currentStream.addTrack(newVideoTrack)

      newStream.getAudioTracks().forEach((t) => {
        t.stop()
      })
    } catch {
      // camera switch failed, keep old camera
    }
  }, [])

  const startRecording = useCallback((): Promise<{ data: string; duration: number } | null> => {
    return new Promise((resolve) => {
      const constraints: MediaStreamConstraints = {
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: true,
      }
      navigator.mediaDevices.getUserMedia(constraints)
        .then((s) => {
          streamRef.current = s
          setHasStream(true)
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

          const recorder = new MediaRecorder(s, { mimeType })
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
  }, [stopRecording, cameraId])

  return {
    recording, duration, hasStream, streamRef,
    devices, cameraId, setCameraId,
    startRecording, stopRecording, cancelRecording, enumerateDevices, switchCamera,
  }
}
