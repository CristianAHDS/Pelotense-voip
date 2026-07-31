export const CODEC_PCM = 0
export const CODEC_OPUS = 1

type EncodeResolver = (frame: ArrayBuffer) => void
type DecodeResolver = (pcm: Float32Array) => void

class PcmCodec {
  readonly name = 'pcm' as const

  async encode(pcm: Float32Array): Promise<ArrayBuffer> {
    const buffer = new ArrayBuffer(pcm.length * 2 + 1)
    const view = new DataView(buffer)
    view.setUint8(0, CODEC_PCM)
    for (let i = 0; i < pcm.length; i++) {
      const sample = Math.max(-1, Math.min(1, pcm[i]))
      view.setInt16(1 + i * 2, sample * 0x7fff, true)
    }
    return buffer
  }

  async decode(frame: ArrayBuffer): Promise<Float32Array> {
    const view = new DataView(frame, 1)
    const samples = (frame.byteLength - 1) / 2
    const output = new Float32Array(samples)
    for (let i = 0; i < samples; i++) {
      output[i] = view.getInt16(i * 2, true) / 0x7fff
    }
    return output
  }

  destroy(): void { /* no-op */ }
}

class OpusCodec {
  readonly name = 'opus' as const
  private sampleRate: number
  private encoder: any = null
  private decoder: any = null
  private encodeTimestamp = 0
  private decodeTimestamp = 0
  private pendingEncode = new Map<number, EncodeResolver>()
  private pendingDecode = new Map<number, DecodeResolver>()

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate
  }

  static isSupported(): boolean {
    const g = globalThis as any
    return typeof g.AudioEncoder !== 'undefined' && typeof g.AudioDecoder !== 'undefined'
  }

  private ensureEncoder(): void {
    if (this.encoder) return
    const g = globalThis as any
    this.encoder = new g.AudioEncoder({
      output: (chunk: any) => {
        const resolver = this.pendingEncode.get(chunk.timestamp)
        if (!resolver) return
        this.pendingEncode.delete(chunk.timestamp)
        const buffer = new ArrayBuffer(chunk.byteLength + 1)
        const bytes = new Uint8Array(buffer)
        bytes[0] = CODEC_OPUS
        chunk.copyTo(buffer.slice(1))
        resolver(buffer)
      },
      error: () => {
        this.pendingEncode.clear()
      },
    })
    this.encoder.configure({ codec: 'opus', sampleRate: this.sampleRate, numberOfChannels: 1, bitrate: 32000 })
  }

  private ensureDecoder(): void {
    if (this.decoder) return
    const g = globalThis as any
    this.decoder = new g.AudioDecoder({
      output: (audioData: any) => {
        const resolver = this.pendingDecode.get(audioData.timestamp)
        if (!resolver) return
        this.pendingDecode.delete(audioData.timestamp)
        const pcm = new Float32Array(audioData.numberOfFrames)
        audioData.copyTo(pcm, { planeIndex: 0 })
        resolver(pcm)
        audioData.close()
      },
      error: () => {
        this.pendingDecode.clear()
      },
    })
    this.decoder.configure({ codec: 'opus', sampleRate: this.sampleRate, numberOfChannels: 1 })
  }

  async encode(pcm: Float32Array): Promise<ArrayBuffer> {
    this.ensureEncoder()
    return new Promise((resolve) => {
      const g = globalThis as any
      const timestamp = this.encodeTimestamp
      this.encodeTimestamp += pcm.length
      this.pendingEncode.set(timestamp, resolve)
      const audioData = new g.AudioData({
        format: 'f32',
        sampleRate: this.sampleRate,
        numberOfFrames: pcm.length,
        timestamp,
        data: pcm,
      })
      this.encoder.encode(audioData)
      audioData.close()
    })
  }

  async decode(frame: ArrayBuffer): Promise<Float32Array> {
    this.ensureDecoder()
    return new Promise((resolve) => {
      const g = globalThis as any
      const timestamp = this.decodeTimestamp
      this.decodeTimestamp += 1
      this.pendingDecode.set(timestamp, resolve)
      const chunk = new g.EncodedAudioChunk({
        type: 'key',
        timestamp,
        data: frame.slice(1),
      })
      this.decoder.decode(chunk)
    })
  }

  destroy(): void {
    try { this.encoder?.close?.() } catch { /* ignore */ }
    try { this.decoder?.close?.() } catch { /* ignore */ }
    this.encoder = null
    this.decoder = null
    this.pendingEncode.clear()
    this.pendingDecode.clear()
  }
}

export class AudioCodec {
  readonly name: 'pcm' | 'opus'
  private pcm: PcmCodec
  private opus: OpusCodec | null

  private constructor(opus: OpusCodec | null) {
    this.pcm = new PcmCodec()
    this.opus = opus
    this.name = opus ? 'opus' : 'pcm'
  }

  static create(): AudioCodec {
    return new AudioCodec(OpusCodec.isSupported() ? new OpusCodec() : null)
  }

  async encode(pcm: Float32Array): Promise<ArrayBuffer> {
    if (this.opus) return this.opus.encode(pcm)
    return this.pcm.encode(pcm)
  }

  async decode(frame: ArrayBuffer): Promise<Float32Array> {
    const codecByte = frame.byteLength > 0 ? new DataView(frame).getUint8(0) : CODEC_PCM
    if (codecByte === CODEC_OPUS) {
      if (!this.opus) throw new Error('Opus not supported by this client')
      return this.opus.decode(frame)
    }
    return this.pcm.decode(frame)
  }

  destroy(): void {
    this.opus?.destroy()
    this.pcm.destroy()
  }
}
