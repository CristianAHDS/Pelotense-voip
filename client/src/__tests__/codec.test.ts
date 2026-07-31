import { describe, it, expect, afterEach, vi } from 'vitest'
import { AudioCodec, CODEC_PCM, CODEC_OPUS } from '../audio/codec.ts'

function sineWave(frames: number, freq = 440, sampleRate = 48000): Float32Array {
  const data = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    data[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.5
  }
  return data
}

function maxAbsError(a: Float32Array, b: Float32Array): number {
  let err = 0
  for (let i = 0; i < a.length; i++) {
    err = Math.max(err, Math.abs(a[i] - b[i]))
  }
  return err
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function installFakeWebCodecs(opts: { encoderOk?: boolean; decoderOk?: boolean; nanDecode?: boolean } = {}) {
  const encoderOk = opts.encoderOk ?? true
  const decoderOk = opts.decoderOk ?? true
  const nanDecode = opts.nanDecode ?? false

  class FakeAudioEncoder {
    constructor(private callbacks: any) {}
    configure(): void {}
    encode(audioData: any): void {
      const timestamp = audioData.timestamp
      if (!encoderOk) {
        this.callbacks.error(new Error('encode failed'))
        return
      }
      const chunk = {
        timestamp,
        byteLength: 4,
        copyTo(dest: ArrayBuffer): void {
          new Uint8Array(dest).fill(9)
        },
      }
      queueMicrotask(() => this.callbacks.output(chunk))
    }
    close(): void {}
  }

  class FakeAudioDecoder {
    constructor(private callbacks: any) {}
    configure(): void {}
    decode(chunk: any): void {
      const timestamp = chunk.timestamp
      if (!decoderOk) {
        this.callbacks.error(new Error('decode failed'))
        return
      }
      const audioData = {
        timestamp,
        numberOfFrames: 8,
        copyTo(pcm: Float32Array): void {
          pcm.fill(nanDecode ? NaN : 0.5)
        },
        close(): void {},
      }
      queueMicrotask(() => this.callbacks.output(audioData))
    }
    close(): void {}
  }

  class FakeAudioData {
    format: string
    sampleRate: number
    numberOfFrames: number
    timestamp: number
    data: Float32Array
    constructor(init: any) {
      this.format = init.format
      this.sampleRate = init.sampleRate
      this.numberOfFrames = init.numberOfFrames
      this.timestamp = init.timestamp
      this.data = init.data
    }
    close(): void {}
  }

  class FakeEncodedAudioChunk {
    type: string
    timestamp: number
    data: ArrayBuffer
    byteLength: number
    constructor(init: any) {
      this.type = init.type
      this.timestamp = init.timestamp
      this.data = init.data
      this.byteLength = init.data.byteLength
    }
    copyTo(dest: ArrayBuffer): void {
      new Uint8Array(dest).set(new Uint8Array(this.data))
    }
  }

  vi.stubGlobal('AudioEncoder', FakeAudioEncoder)
  vi.stubGlobal('AudioDecoder', FakeAudioDecoder)
  vi.stubGlobal('AudioData', FakeAudioData)
  vi.stubGlobal('EncodedAudioChunk', FakeEncodedAudioChunk)
}

describe('AudioCodec', () => {
  it('usa PCM quando WebCodecs não está disponível', () => {
    expect((globalThis as any).AudioEncoder).toBeUndefined()
    const codec = AudioCodec.create()
    expect(codec.name).toBe('pcm')
    codec.destroy()
  })

  it('codifica e decodifica PCM com roundtrip aproximado', async () => {
    const codec = AudioCodec.create()
    const input = sineWave(480)

    const frame = await codec.encode(input)
    expect(new DataView(frame).getUint8(0)).toBe(CODEC_PCM)
    expect(frame.byteLength).toBe(input.length * 2 + 1)

    const output = await codec.decode(frame)
    expect(output.length).toBe(input.length)
    expect(maxAbsError(input, output)).toBeLessThan(0.01)
    codec.destroy()
  })

  it('retorna silêncio para frame Opus sem suporte (não lança)', async () => {
    const codec = AudioCodec.create()
    const fakeOpus = new ArrayBuffer(5)
    new Uint8Array(fakeOpus)[0] = CODEC_OPUS
    const output = await codec.decode(fakeOpus)
    expect(output.length).toBe(0)
    codec.destroy()
  })

  it('codifica e decodifica Opus usando WebCodecs fake', async () => {
    installFakeWebCodecs()
    const codec = AudioCodec.create()
    expect(codec.name).toBe('opus')

    const frame = await codec.encode(sineWave(480))
    expect(new DataView(frame).getUint8(0)).toBe(CODEC_OPUS)

    const output = await codec.decode(frame)
    expect(output.length).toBe(8)
    expect(output.every((s) => s === 0.5)).toBe(true)
    codec.destroy()
  })

  it('sanitiza amostras NaN vindas do decoder Opus', async () => {
    installFakeWebCodecs({ nanDecode: true })
    const codec = AudioCodec.create()

    const fakeOpus = new ArrayBuffer(5)
    new Uint8Array(fakeOpus)[0] = CODEC_OPUS
    const output = await codec.decode(fakeOpus)

    expect(output.length).toBe(8)
    expect(output.every((s) => s === 0)).toBe(true)
    codec.destroy()
  })

  it('cai para PCM quando o encoder Opus falha', async () => {
    vi.useFakeTimers()
    installFakeWebCodecs({ encoderOk: false })
    const codec = AudioCodec.create()
    expect(codec.name).toBe('opus')

    const input = sineWave(480)
    const first = codec.encode(input)
    await vi.advanceTimersByTimeAsync(300)
    await first

    const frame = await codec.encode(input)
    expect(codec.name).toBe('pcm')
    expect(new DataView(frame).getUint8(0)).toBe(CODEC_PCM)
    expect(frame.byteLength).toBe(input.length * 2 + 1)

    const output = await codec.decode(frame)
    expect(maxAbsError(input, output)).toBeLessThan(0.01)
    codec.destroy()
  })

  it('retorna silêncio imediato quando o decoder Opus falha', async () => {
    vi.useFakeTimers()
    installFakeWebCodecs({ decoderOk: false })
    const codec = AudioCodec.create()

    const fakeOpus = new ArrayBuffer(5)
    new Uint8Array(fakeOpus)[0] = CODEC_OPUS
    const p1 = codec.decode(fakeOpus)
    await vi.advanceTimersByTimeAsync(300)
    await p1

    const output = await codec.decode(fakeOpus)
    expect(output.length).toBe(0)
    expect(codec.name).toBe('pcm')
    codec.destroy()
  })
})
