import { describe, it, expect, afterEach, vi } from 'vitest'
import { VoiceManager } from '../voice/voiceManager.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { Microphone } from '../audio/microphone.ts'
import { CODEC_OPUS } from '../audio/codec.ts'

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static sources: any[] = []
  state = 'suspended'
  currentTime = 0
  audioWorklet = { addModule: vi.fn(() => Promise.resolve()) }
  resume = vi.fn(() => {
    this.state = 'running'
    return Promise.resolve()
  })

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createGain(): any {
    return {
      gain: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
  }

  createDynamicsCompressor(): any {
    return { connect: vi.fn(), disconnect: vi.fn() }
  }

  createBuffer(_channels: number, length: number): any {
    return { getChannelData: () => new Float32Array(length) }
  }

  createBufferSource(): any {
    const source = {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    }
    FakeAudioContext.sources.push(source)
    return source
  }

  createMediaStreamSource(): any {
    return { connect: vi.fn(), disconnect: vi.fn() }
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
  vi.stubGlobal('AudioWorkletNode', class FakeAudioWorkletNode {
    port = { onmessage: null as any }
    disconnect(): void {}
  })
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function installFakeMediaDevices(devices: Array<{ kind: string; deviceId: string; label: string }>): { getUserMedia: ReturnType<typeof vi.fn> } {
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue(devices),
      getUserMedia,
    },
  })
  return { getUserMedia }
}

function opusFrame(): ArrayBuffer {
  const buffer = new ArrayBuffer(5)
  new Uint8Array(buffer)[0] = CODEC_OPUS
  return buffer
}

afterEach(() => {
  FakeAudioContext.instances = []
  FakeAudioContext.sources = []
  useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, rxLevel: 0, speaking: {} })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (navigator as any).mediaDevices
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

  it('listMicrophones retorna apenas dispositivos de entrada de áudio', async () => {
    installFakeWebCodecs()
    installFakeMediaDevices([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Microfone USB' },
      { kind: 'videoinput', deviceId: 'cam-1', label: 'Camera' },
      { kind: 'audioinput', deviceId: 'mic-2', label: '' },
    ])
    const vm = new VoiceManager()
    const devices = await vm.listMicrophones()
    expect(devices).toEqual([
      { deviceId: 'mic-1', label: 'Microfone USB' },
      { deviceId: 'mic-2', label: '' },
    ])
    vm.destroy()
  })

  it('setMicrophone troca o dispositivo e reinicia o mic ativo com o deviceId', async () => {
    installFakeWebCodecs()
    const { getUserMedia } = installFakeMediaDevices([])
    const vm = new VoiceManager()
    await vm.startMicrophone()
    expect(vm.activeMic).toBe(true)

    await vm.setMicrophone('mic-1')
    await flush()

    const lastCall = getUserMedia.mock.calls[getUserMedia.mock.calls.length - 1][0] as { audio: MediaTrackConstraints }
    expect(lastCall.audio.deviceId).toEqual({ exact: 'mic-1' })
    expect(vm.activeMic).toBe(true)
    vm.destroy()
  })

  it('setMicrophone sem mic ativo apenas define o dispositivo para o próximo start', async () => {
    installFakeWebCodecs()
    const { getUserMedia } = installFakeMediaDevices([])
    const vm = new VoiceManager()
    await vm.setMicrophone('mic-1')
    expect(vm.activeMic).toBe(false)
    expect(getUserMedia).not.toHaveBeenCalled()

    await vm.startMicrophone()
    const constraints = getUserMedia.mock.calls[0][0] as { audio: MediaTrackConstraints }
    expect(constraints.audio.deviceId).toEqual({ exact: 'mic-1' })
    vm.destroy()
  })

  it('flushAudio para imediatamente os buffers agendados de saída', async () => {
    installFakeWebCodecs()
    const vm = new VoiceManager()
    vm.playAudio(opusFrame())
    await flush()
    expect(FakeAudioContext.sources.length).toBeGreaterThan(0)

    vm.flushAudio()
    for (const source of FakeAudioContext.sources) {
      expect(source.stop).toHaveBeenCalled()
    }
    expect(useVoiceStore.getState().rxLevel).toBe(0)
    vm.destroy()
  })

  it('não deixa a fila de saída acumular mais que ~150ms à frente do tempo atual', async () => {
    installFakeWebCodecs()
    const vm = new VoiceManager()
    vm.playAudio(opusFrame())
    await flush()
    const speakerCtx = FakeAudioContext.instances[0]

    speakerCtx.currentTime = 10
    for (let i = 0; i < 50; i++) {
      vm.playAudio(opusFrame())
      await flush()
    }

    const lastStart = FakeAudioContext.sources[FakeAudioContext.sources.length - 1].start.mock.calls[0][0] as number
    expect(lastStart - speakerCtx.currentTime).toBeLessThanOrEqual(0.15)
    vm.destroy()
  })
})

describe('VoiceManager (envio de voz)', () => {
  it('o mudo controla o envio (muted=true não envia)', async () => {
    installFakeWebCodecs()
    installFakeMediaDevices([])
    useVoiceStore.getState().setMuted(true)

    const sent: number[] = []
    const vm = new VoiceManager()
    vm.setOnSend(() => sent.push(1))
    const setOnDataSpy = vi.spyOn(Microphone.prototype, 'setOnData')
    await vm.startMicrophone()
    const onData = setOnDataSpy.mock.calls[0][0] as (data: Float32Array) => void

    onData(new Float32Array(160).fill(0.5))
    await flush()
    expect(sent).toHaveLength(0)

    useVoiceStore.getState().setMuted(false)
    onData(new Float32Array(160).fill(0.5))
    await flush()
    expect(sent.length).toBeGreaterThan(0)
    vm.destroy()
  })
})

describe('VoiceManager (double-start / chiado)', () => {
  it('startMicrophone concorrente não abre uma segunda stream', async () => {
    installFakeWebCodecs()
    const { getUserMedia } = installFakeMediaDevices([])
    const vm = new VoiceManager()

    const [a, b] = await Promise.all([vm.startMicrophone(), vm.startMicrophone()])
    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    vm.destroy()
  })

  it('startMicrophone em andamento reutiliza a promise (login + join)', async () => {
    installFakeWebCodecs()
    const { getUserMedia } = installFakeMediaDevices([])
    const vm = new VoiceManager()

    const first = vm.startMicrophone()
    const second = vm.startMicrophone()
    await Promise.all([first, second])

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(vm.activeMic).toBe(true)
    vm.destroy()
  })

  it('start após um start concluído é no-op (não reinicia a stream)', async () => {
    installFakeWebCodecs()
    const { getUserMedia } = installFakeMediaDevices([])
    const vm = new VoiceManager()

    await vm.startMicrophone()
    await vm.startMicrophone()

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    vm.destroy()
  })

  it('novo start após um stop cria uma stream nova (comportamento de troca de mic)', async () => {
    installFakeWebCodecs()
    const { getUserMedia } = installFakeMediaDevices([])
    const vm = new VoiceManager()

    await vm.startMicrophone()
    vm.stopMicrophone()
    await vm.startMicrophone()

    expect(getUserMedia).toHaveBeenCalledTimes(2)
    vm.destroy()
  })
})
