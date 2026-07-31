import { describe, it, expect, vi } from 'vitest'
import { audioMessageFilename } from '../utils/download.ts'

describe('audioMessageFilename', () => {
  it('gera nome com usuário sanitizado e timestamp', () => {
    const ts = new Date(2026, 0, 5, 14, 30).getTime()
    expect(audioMessageFilename('João Silva', ts, 'wav')).toMatch(/^Jo_o_Silva-\d{2}-\d{2}-\d{4}_\d{2}-\d{2}\.wav$/)
  })
})

describe('convertAudioToWavBlob', () => {
  it('decodifica áudio e gera um blob WAV', async () => {
    const audioBuffer = {
      numberOfChannels: 1,
      sampleRate: 8000,
      length: 2,
      getChannelData: () => new Float32Array([0.5, -0.5]),
    } as unknown as AudioBuffer

    const decode = vi.fn().mockResolvedValue(audioBuffer)
    const close = vi.fn().mockResolvedValue(undefined)
    const MockContext = class { decodeAudioData = decode; close = close } as unknown as typeof AudioContext

    const { convertAudioToWavBlob } = await import('../utils/download.ts')
    vi.stubGlobal('AudioContext', MockContext)

    const blob = await convertAudioToWavBlob('AAAAAAAA')
    expect(blob).not.toBeNull()
    expect(blob!.type).toBe('audio/wav')

    const header = new Uint8Array(await blob!.arrayBuffer()).slice(0, 4)
    expect(new TextDecoder().decode(header)).toBe('RIFF')
    vi.unstubAllGlobals()
  })

  it('retorna null se a decodificação falhar', async () => {
    const decode = vi.fn().mockRejectedValue(new Error('decode'))
    const close = vi.fn().mockResolvedValue(undefined)
    const MockContext = class { decodeAudioData = decode; close = close } as unknown as typeof AudioContext

    const { convertAudioToWavBlob } = await import('../utils/download.ts')
    vi.stubGlobal('AudioContext', MockContext)

    expect(await convertAudioToWavBlob('AAAAAAAA')).toBeNull()
    vi.unstubAllGlobals()
  })
})
