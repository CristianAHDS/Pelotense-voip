import { describe, it, expect } from 'vitest'
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

  it('lança erro ao decodificar frame Opus sem suporte', async () => {
    const codec = AudioCodec.create()
    const fakeOpus = new ArrayBuffer(5)
    new Uint8Array(fakeOpus)[0] = CODEC_OPUS
    await expect(codec.decode(fakeOpus)).rejects.toThrow()
    codec.destroy()
  })
})
