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
  // Só alimenta o RX com o contexto rodando: se estiver suspenso (aba em
  // segundo plano/alt-tab) o analyser devolve 0 e "apaga" o medidor.
  if (analyser && freq && active.size > 0 && ctx && ctx.state === 'running') {
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

// Ao voltar para a aba/janela (alt-tab), o AudioContext pode ter ficado
// suspenso e o medidor "apaga"; retomamos o contexto e o loop.
function resumeIfNeeded(): void {
  void ensure()?.ctx.resume()
  if (active.size > 0 && !running) start()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeIfNeeded()
  })
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', resumeIfNeeded)
  window.addEventListener('pageshow', resumeIfNeeded)
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

// Live (WebRTC): roteia o áudio do MediaStream pelo analyser (via um gain por
// fonte, para permitir mutar cada live separadamente) e silencia o elemento de
// vídeo para não haver som em dobro (elemento + contexto).
const streamGains = new Map<string, GainNode>()

export function attachMediaStream(stream: MediaStream, key: string, videoEl?: HTMLMediaElement | null): void {
  const r = ensure()
  if (!r) return
  try {
    const src = r.ctx.createMediaStreamSource(stream)
    const gain = r.ctx.createGain()
    gain.gain.value = 1
    streamGains.set(key, gain)
    src.connect(gain)
    gain.connect(r.analyser)
    void r.ctx.resume()
  } catch {
    return
  }
  if (videoEl) videoEl.muted = true
  markActive(key, true)
}

// Muta/desmuta o áudio de UMA live específica (por chave da fonte).
export function setStreamMuted(key: string, muted: boolean): void {
  const gain = streamGains.get(key)
  if (gain) gain.gain.value = muted ? 0 : 1
  // Chamado dentro de um gesto do usuário (clique no mute): aproveita para
  // retomar o contexto, evitando o bloqueio de autoplay que deixa o áudio parado.
  void ensure()?.ctx.resume()
}

// Libera a fonte (e o medidor) quando a live sai da tela.
export function releaseStream(key: string): void {
  streamGains.delete(key)
  markActive(key, false)
}

// Analisador de nível por fonte, reutilizando o contexto compartilhado (evita
// criar um AudioContext por tile, que o Chrome bloqueia por autoplay e gera
// aviso no console). Não conecta ao destination — só mede o nível.
export function createStreamLevel(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const r = ensure()
  if (!r) return () => {}
  let raf = 0
  try {
    const src = r.ctx.createMediaStreamSource(stream)
    const analyser = r.ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.4
    src.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    const loop = () => {
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      onLevel(Math.min(1, (sum / data.length / 255) * 1.6))
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      try { src.disconnect() } catch { /* ignore */ }
      try { analyser.disconnect() } catch { /* ignore */ }
    }
  } catch {
    return () => { cancelAnimationFrame(raf) }
  }
}

// Retoma o contexto compartilhado no primeiro gesto do usuário (clique/tecla/
// toque): a política de autoplay exige que o AudioContext seja criado/retomado
// após um gesto para não ficar suspenso (e para não gerar aviso no console).
function resumeOnFirstGesture(): void {
  const resume = () => { void ensure()?.ctx.resume() }
  const events = ['pointerdown', 'keydown', 'touchstart']
  for (const ev of events) {
    window.addEventListener(ev, resume, { once: true, passive: true })
  }
}

if (typeof window !== 'undefined') {
  resumeOnFirstGesture()
}
