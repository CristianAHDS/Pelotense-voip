import { useState, useRef, useCallback } from 'react'
import { getUserMediaWithMic } from '../utils/media.ts'

// Teste de microfone: captura o áudio do mic escolhido e devolve nos alto-falantes
// (monitor ao vivo), com medidor de nível para verificar se está captando.
export function useMicTest() {
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)

  const start = useCallback(async () => {
    if (streamRef.current) return
    const stream = await getUserMediaWithMic(false, true)
    if (!stream) return
    const Ctor: typeof AudioContext | undefined =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    const ctx = new Ctor()
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    const gain = ctx.createGain()
    gain.gain.value = 0.6
    src.connect(analyser)
    analyser.connect(gain)
    gain.connect(ctx.destination)

    streamRef.current = stream
    ctxRef.current = ctx
    srcRef.current = src
    analyserRef.current = analyser

    const data = new Uint8Array(analyser.frequencyBinCount)
    const loop = (): void => {
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      const avg = sum / data.length
      setLevel(Math.min(1, avg / 128))
      rafRef.current = requestAnimationFrame(loop)
    }
    loop()
    setTesting(true)
  }, [])

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    try { srcRef.current?.disconnect() } catch { /* ignore */ }
    srcRef.current = null
    analyserRef.current = null
    try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
    streamRef.current = null
    try { ctxRef.current?.close() } catch { /* ignore */ }
    ctxRef.current = null
    setLevel(0)
    setTesting(false)
  }, [])

  return { testing, level, start, stop }
}
