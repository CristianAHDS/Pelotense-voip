import { useVoiceStore } from '../stores/voiceStore.ts'

// Medidor de nível de saída para fontes que NÃO são voz em tempo real
// (mensagens de áudio/vídeo, live e o bot da rádio). A voz já alimenta o
// `rxLevel` via `VoiceManager.playAudio`; aqui o medidor só escreve enquanto
// uma dessas fontes está de fato reproduzindo, para não sobrescrever a voz.
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let freq: Uint8Array<ArrayBuffer> | null = null
let raf = 0
let running = false
const active = new Set<string>()

function ensure(): { ctx: AudioContext; analyser: AnalyserNode } | null {
  if (ctx && analyser) return { ctx, analyser }
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.6
    analyser.connect(ctx.destination)
    freq = new Uint8Array(analyser.frequencyBinCount)
  } catch {
    ctx = null
    analyser = null
    return null
  }
  return { ctx, analyser }
}

function loop(): void {
  if (!running) return
  if (analyser && freq && active.size > 0) {
    analyser.getByteFrequencyData(freq)
    let sum = 0
    for (let i = 0; i < freq.length; i++) sum += freq[i]
    const avg = Math.min(1, (sum / freq.length / 255) * 1.8)
    useVoiceStore.getState().setRxLevel(avg)
  }
  raf = requestAnimationFrame(loop)
}

function start(): void {
  if (running) return
  running = true
  raf = requestAnimationFrame(loop)
}

function stop(): void {
  running = false
  cancelAnimationFrame(raf)
}

function release(key: string): void {
  active.delete(key)
  if (active.size === 0) {
    stop()
    useVoiceStore.getState().setRxLevel(0)
  }
}

// Liga/desliga manualmente uma fonte (ex: rádio codec que não passa por
// MediaElementSource). Enquanto ligada, o loop do analyser alimenta o RX.
export function markActive(key: string, on: boolean): void {
  if (on) {
    if (!active.has(key)) {
      active.add(key)
      start()
    }
    void ensure()?.ctx.resume()
  } else {
    release(key)
  }
}

// Fontes WebAudio que reportam o próprio nível (rádio codec). Não usa o
// analyser compartilhado (contexto diferente), então o nível vem pronto.
export function reportExternal(key: string, level: number): void {
  if (!active.has(key)) {
    active.add(key)
    start()
  }
  useVoiceStore.getState().setRxLevel(Math.min(1, level))
}

// Roteia um <audio>/<video> pelo analyser compartilhado e acompanha o play/pause.
export function attachMediaElement(el: HTMLMediaElement, key: string): void {
  if (!el || (el as unknown as { __meter?: boolean }).__meter) return
  const r = ensure()
  if (!r) return
  try {
    const src = r.ctx.createMediaElementSource(el)
    src.connect(r.analyser)
    ;(el as unknown as { __meter?: boolean }).__meter = true
  } catch {
    return
  }
  const onPlaying = () => markActive(key, true)
  const onStop = () => release(key)
  el.addEventListener('playing', onPlaying)
  el.addEventListener('play', onPlaying)
  el.addEventListener('pause', onStop)
  el.addEventListener('ended', onStop)
  el.addEventListener('emptied', onStop)
}

export function resetMeter(): void {
  active.clear()
  stop()
  useVoiceStore.getState().setRxLevel(0)
}

// Live (WebRTC): roteia o áudio do MediaStream pelo analyser e silencia o
// elemento de vídeo para não haver som em dobro (elemento + contexto).
export function attachMediaStream(stream: MediaStream, key: string, videoEl?: HTMLMediaElement | null): void {
  const r = ensure()
  if (!r) return
  try {
    const src = r.ctx.createMediaStreamSource(stream)
    src.connect(r.analyser)
    void r.ctx.resume()
  } catch {
    return
  }
  if (videoEl) videoEl.muted = true
  markActive(key, true)
}
