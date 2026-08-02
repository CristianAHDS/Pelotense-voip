import { attachMediaElement, reportExternal, markActive } from '../audio/audioMeter.ts'

export const RADIO_STREAM_URL = 'https://servidor38-5.brlogic.com:7094/live'

export type RadioState = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

export interface RadioPlayer {
  readonly usingFallback: boolean
  play: () => Promise<void>
  pause: () => void
  stop: () => void
  onStateChange: (cb: (s: RadioState) => void) => () => void
}

const SAMPLE_RATE_TABLE = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

interface AdtsHeader {
  sampleRate: number
  channels: number
  aot: number
  frameLength: number
  headerSize: number
}

function parseAdtsHeader(buf: Uint8Array, offset: number): AdtsHeader | null {
  if (offset + 7 > buf.length) return null
  const b0 = buf[offset]
  const b1 = buf[offset + 1]
  if (b0 !== 0xff || (b1 & 0xf6) !== 0xf0) return null
  const protectionAbsent = (b1 & 0x01) === 1
  const sfIndex = (buf[offset + 2] >> 2) & 0x0f
  const profile = (buf[offset + 2] >> 6) & 0x03
  const channels = ((buf[offset + 2] & 0x01) << 2) | ((buf[offset + 3] >> 6) & 0x03)
  const frameLength = ((buf[offset + 3] & 0x03) << 11) | (buf[offset + 4] << 3) | (buf[offset + 5] >> 5)
  const headerSize = protectionAbsent ? 7 : 9
  if (frameLength < headerSize || sfIndex >= SAMPLE_RATE_TABLE.length) return null
  return {
    sampleRate: SAMPLE_RATE_TABLE[sfIndex],
    channels,
    aot: profile + 1,
    frameLength,
    headerSize,
  }
}

function findSync(buf: Uint8Array, start: number): number {
  for (let i = start; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xf6) === 0xf0) return i
  }
  return -1
}

class CodecRadioPlayer implements RadioPlayer {
  readonly usingFallback = false
  private ctx: AudioContext | null = null
  private decoder: AudioDecoder | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private abortCtrl: AbortController | null = null
  private pending = new Uint8Array(0)
  private frameIndex = 0
  private configured = false
  private sampleRate = 44100
  private scheduledUntil = 0
  private wantPlaying = false
  private failed = false
  private _state: RadioState = 'idle'
  private stateCbs: Set<(s: RadioState) => void> = new Set()
  // VU do RX: mede o nível da rádio para o medidor reagir.
  private analyser: AnalyserNode | null = null
  private levelData: Uint8Array<ArrayBuffer> | null = null
  private meterRaf = 0
  // Fontes agendadas: para parar o som IMEDIATAMENTE (sem esperar o ctx fechar)
  // e evitar dois "players" sobrepostos num stop/start rápido.
  private activeSources = new Set<AudioBufferSourceNode>()

  play = async (): Promise<void> => {
    this.wantPlaying = true
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) throw new Error('AudioContext indisponível')
      this.ctx = new Ctor()
    }
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume() } catch { /* segue */ }
    }
    if (this.ctx.state !== 'running') {
      // Autoplay bloqueado: o componente tenta de novo na primeira interação.
      this.setState('paused')
      throw new Error('autoplay bloqueado')
    }
    this.ensureStream()
  }

  pause = (): void => {
    this.wantPlaying = false
    this.stopMeter()
    this.stopStream()
    this.setState('paused')
  }

  stop = (): void => {
    this.wantPlaying = false
    this.stopMeter()
    this.stopStream()
    if (this.ctx) {
      this.ctx.close().catch(() => {})
      this.ctx = null
    }
    // O analyser pertencia ao contexto fechado; sem reset, o próximo play
    // conectaria o áudio num nó de um contexto morto (som nunca voltava).
    this.analyser = null
    this.levelData = null
    this.setState('idle')
  }

  onStateChange = (cb: (s: RadioState) => void): (() => void) => {
    this.stateCbs.add(cb)
    return () => {
      this.stateCbs.delete(cb)
    }
  }

  private setState(s: RadioState): void {
    if (this._state === s) return
    this._state = s
    this.stateCbs.forEach((cb) => cb(s))
  }

  private ensureStream(): void {
    if (this.decoder || !this.wantPlaying) return
    this.setState('loading')
    this.failed = false
    this.frameIndex = 0
    this.configured = false
    this.pending = new Uint8Array(0)
    this.scheduledUntil = (this.ctx?.currentTime ?? 0) + 0.3

    this.abortCtrl = new AbortController()
    fetch(RADIO_STREAM_URL, { signal: this.abortCtrl.signal })
      .then((res) => {
        if (!res.ok || !res.body) throw new Error('resposta inválida')
        this.reader = res.body.getReader()
        return this.readLoop()
      })
      .catch((e: unknown) => {
        if ((e as Error).name === 'AbortError') return
        this.fail()
      })
  }

  private async readLoop(): Promise<void> {
    try {
      while (this.reader && this.wantPlaying) {
        const { value, done } = await this.reader.read()
        if (done) break
        if (value && value.byteLength > 0) this.appendBytes(new Uint8Array(value))
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.fail()
    }
  }

  private appendBytes(chunk: Uint8Array): void {
    const combined = new Uint8Array(this.pending.length + chunk.length)
    combined.set(this.pending)
    combined.set(chunk, this.pending.length)

    let offset = 0
    while (true) {
      const start = findSync(combined, offset)
      if (start === -1) break
      const hdr = parseAdtsHeader(combined, start)
      if (!hdr || start + hdr.frameLength > combined.length) {
        if (!hdr) {
          offset = start + 1
          continue
        }
        break
      }
      offset = start + hdr.frameLength
      const payload = combined.slice(start + hdr.headerSize, start + hdr.frameLength)
      if (!this.configured) {
        if (!this.tryConfigure(hdr)) return
      }
      if (this.failed || !this.decoder) return
      if (this.decoder.decodeQueueSize > 64) {
        // Sobrecarga do decoder: descarta o frame mas mantém a contagem de
        // timestamps coerente (sem "rolar para trás" na reprodução).
        this.frameIndex++
        continue
      }
      const ts = Math.round((this.frameIndex * 1024 * 1e6) / this.sampleRate)
      this.frameIndex++
      try {
        this.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: ts, data: payload }))
      } catch {
        this.fail()
        return
      }
    }
    this.pending = combined.slice(offset)
  }

  private tryConfigure(hdr: AdtsHeader): boolean {
    this.sampleRate = hdr.sampleRate
    if (typeof AudioDecoder === 'undefined') {
      this.fail()
      return false
    }
    this.decoder = new AudioDecoder({
      output: (data) => this.playAudioData(data),
      error: () => this.fail(),
    })
    try {
      this.decoder.configure({
        codec: `mp4a.40.${hdr.aot}`,
        sampleRate: hdr.sampleRate,
        numberOfChannels: hdr.channels,
      })
      this.configured = true
      return true
    } catch {
      this.fail()
      return false
    }
  }

  private playAudioData(data: AudioData): void {
    if (!this.ctx || this.failed) {
      data.close()
      return
    }
    try {
      const buffer = this.toAudioBuffer(data)
      data.close()
      this.schedule(buffer)
    } catch {
      data.close()
    }
  }

  private toAudioBuffer(data: AudioData): AudioBuffer {
    const ctx = this.ctx!
    const frameCount = data.numberOfFrames
    const channels = data.numberOfChannels
    const buffer = ctx.createBuffer(channels, frameCount, data.sampleRate)
    if (data.format === 'f32') {
      const interleaved = new Float32Array(frameCount * channels)
      data.copyTo(interleaved, { planeIndex: 0 })
      for (let ch = 0; ch < channels; ch++) {
        const out = buffer.getChannelData(ch)
        for (let i = 0; i < frameCount; i++) out[i] = interleaved[i * channels + ch]
      }
    } else {
      for (let ch = 0; ch < channels; ch++) {
        data.copyTo(buffer.getChannelData(ch), { planeIndex: ch })
      }
    }
    return buffer
  }

  private schedule(buffer: AudioBuffer): void {
    const ctx = this.ctx!
    const now = ctx.currentTime
    if (this.scheduledUntil <= 0 || this.scheduledUntil < now - 0.05) {
      this.scheduledUntil = now + 0.05
    }
    const node = ctx.createBufferSource()
    node.buffer = buffer
    // Roteia pelo analyser para o VU reagir ao som da rádio.
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.smoothingTimeConstant = 0.6
      this.analyser.connect(ctx.destination)
      this.levelData = new Uint8Array(this.analyser.frequencyBinCount)
    }
    node.connect(this.analyser)
    this.activeSources.add(node)
    node.onended = () => this.activeSources.delete(node)
    node.start(this.scheduledUntil)
    this.scheduledUntil += buffer.duration
    if (this._state !== 'playing') this.setState('playing')
    this.startMeter()
  }

  private startMeter(): void {
    if (this.meterRaf) return
    const loop = () => {
      if (!this.wantPlaying || !this.analyser || !this.levelData) {
        this.stopMeter()
        return
      }
      // Só mede com o contexto rodando (aba visível); senão reportaria 0 e
      // apagaria o VU (alt-tab / aba em segundo plano).
      if (this.ctx && this.ctx.state === 'running') {
        this.analyser.getByteFrequencyData(this.levelData)
        let sum = 0
        for (let i = 0; i < this.levelData.length; i++) sum += this.levelData[i]
        reportExternal('radio-codec', Math.min(1, (sum / this.levelData.length / 255) * 1.8))
      }
      this.meterRaf = requestAnimationFrame(loop)
    }
    this.meterRaf = requestAnimationFrame(loop)
  }

  private stopMeter(): void {
    if (this.meterRaf) {
      cancelAnimationFrame(this.meterRaf)
      this.meterRaf = 0
    }
    markActive('radio-codec', false)
  }

  // Ao voltar para a aba, retoma o contexto (suspenso em segundo plano) para
  // o áudio e o medidor voltarem a funcionar.
  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume()
      }
      if (this.wantPlaying && this._state === 'playing') {
        this.startMeter()
      }
    }
  }

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility)
    }
  }

  private stopStream(): void {
    // Para o som na hora (fontes agendadas), sem esperar o contexto fechar.
    for (const source of this.activeSources) {
      try { source.stop() } catch { /* já finalizada/não iniciada */ }
    }
    this.activeSources.clear()
    if (this.abortCtrl) {
      this.abortCtrl.abort()
      this.abortCtrl = null
    }
    this.reader = null
    if (this.decoder) {
      try { this.decoder.reset() } catch { /* ignore */ }
      this.decoder = null
    }
    this.configured = false
  }

  private fail(): void {
    if (this.failed) return
    this.failed = true
    this.stopStream()
    this.setState('error')
  }
}

class AudioElementRadioPlayer implements RadioPlayer {
  readonly usingFallback = true
  private audio: HTMLAudioElement | null = null
  private _state: RadioState = 'idle'
  private stateCbs: Set<(s: RadioState) => void> = new Set()

  private ensureElement(): HTMLAudioElement {
    if (this.audio) return this.audio
    const audio = document.createElement('audio')
    audio.preload = 'none'
    audio.src = RADIO_STREAM_URL
    attachMediaElement(audio, 'radio-element')
    audio.addEventListener('playing', () => this.setState('playing'))
    audio.addEventListener('pause', () => this.setState('paused'))
    audio.addEventListener('waiting', () => this.setState('loading'))
    audio.addEventListener('error', () => {
      this.stopStream()
      this.setState('error')
    })
    this.audio = audio
    return audio
  }

  play = async (): Promise<void> => {
    const audio = this.ensureElement()
    this.setState('loading')
    try {
      await audio.play()
      this.setState('playing')
    } catch {
      this.setState('paused')
      throw new Error('autoplay bloqueado')
    }
  }

  pause = (): void => {
    if (this.audio) this.audio.pause()
    this.setState('paused')
  }

  stop = (): void => {
    this.stopStream()
    this.setState('idle')
    // Recria o elemento no próximo play (o src foi removido no stopStream).
    this.audio = null
  }

  onStateChange = (cb: (s: RadioState) => void): (() => void) => {
    this.stateCbs.add(cb)
    return () => {
      this.stateCbs.delete(cb)
    }
  }

  private setState(s: RadioState): void {
    if (this._state === s) return
    this._state = s
    this.stateCbs.forEach((cb) => cb(s))
  }

  private stopStream(): void {
    if (this.audio) {
      try { this.audio.pause() } catch { /* ignore */ }
      try { this.audio.removeAttribute('src') } catch { /* ignore */ }
    }
  }
}

function createRadioPlayer(): RadioPlayer {
  try {
    if (
      typeof AudioDecoder !== 'undefined'
      && (typeof AudioContext !== 'undefined' || !!(window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)
    ) {
      return new CodecRadioPlayer()
    }
  } catch { /* usa fallback */ }
  return new AudioElementRadioPlayer()
}

export const radioPlayer: RadioPlayer = createRadioPlayer()
