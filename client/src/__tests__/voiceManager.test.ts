import { describe, it, expect, afterEach, vi } from 'vitest'
import { VoiceManager } from '../voice/voiceManager.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { CODEC_OPUS } from '../audio/codec.ts'

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state = 'suspended'
  currentTime = 0
  resume = vi.fn(() => {
    this.state = 'running'
    return Promise.resolve()
  })

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createGain(): any {
    return { gain: { value: 0 }, connect: vi.fn() }
  }

  createBuffer(_channels: number, length: number): any {
    return { getChannelData: () => new Float32Array(length) }
  }

  createBufferSource(): any {
    return { buffer: null, connect: vi.fn(), start: vi.fn() }
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

function installFakeWebCodecs(opts: { nanDecode?: boolean } = {}): void {
  const nanDecode = opts.nanDecode ?? false

  class FakeAudioEncoder {
    constructor(private callbacks: any) {}
    configure(): void {}
    encode(audioData: any): void {
      const chunk = {
        timestamp: audioData.timestamp,
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
      const audioData = {
        timestamp: chunk.timestamp,
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
  vi.stubGlobal('AudioContext', FakeAudioContext)
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function opusFrame(): ArrayBuffer {
  const buffer = new ArrayBuffer(5)
  new Uint8Array(buffer)[0] = CODEC_OPUS
  return buffer
}

afterEach(() => {
  FakeAudioContext.instances = []
  useVoiceStore.getState().setRxLevel(0)
  vi.unstubAllGlobals()
})

describe('VoiceManager (playAudio)', () => {
  it('atualiza o rxLevel no store ao reproduzir áudio recebido', async () => {
    installFakeWebCodecs()
    const vm = new VoiceManager()
    vm.playAudio(opusFrame())
    await flush()

    expect(useVoiceStore.getState().rxLevel).toBeGreaterThan(0)
    vm.destroy()
  })

  it('mantém o rxLevel em 0 quando o áudio decodificado é inválido (NaN)', async () => {
    installFakeWebCodecs({ nanDecode: true })
    const vm = new VoiceManager()
    vm.playAudio(opusFrame())
    await flush()

    expect(useVoiceStore.getState().rxLevel).toBe(0)
    vm.destroy()
  })

  it('resumeOutput cria e retoma o AudioContext de saída (gesto, mic mutado)', async () => {
    installFakeWebCodecs()
    const vm = new VoiceManager()
    vm.resumeOutput()
    await flush()

    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(FakeAudioContext.instances[0].state).toBe('running')
    vm.destroy()
  })
})
