import { describe, it, expect, afterEach, vi } from 'vitest'
import { Speaker } from '../audio/speaker.ts'

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state = 'suspended'
  currentTime = 0
  gainNodes: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn> }> = []
  closeCalls = 0
  resume: ReturnType<typeof vi.fn>

  constructor() {
    this.resume = vi.fn(() => {
      this.state = 'running'
      return Promise.resolve()
    })
    FakeAudioContext.instances.push(this)
  }

  createGain(): any {
    const node = { gain: { value: 0 }, connect: vi.fn() }
    this.gainNodes.push(node)
    return node
  }

  createBuffer(_channels: number, length: number): any {
    return { getChannelData: () => new Float32Array(length) }
  }

  createBufferSource(): any {
    return { buffer: null, connect: vi.fn(), start: vi.fn() }
  }

  close(): Promise<void> {
    this.closeCalls += 1
    return Promise.resolve()
  }
}

function samples(length: number): Float32Array {
  return new Float32Array(length).fill(0.1)
}

afterEach(() => {
  FakeAudioContext.instances = []
  vi.unstubAllGlobals()
})

function installAudioContext(): void {
  vi.stubGlobal('AudioContext', FakeAudioContext)
}

describe('Speaker', () => {
  it('retoma o contexto suspenso (autoplay) ao reproduzir', () => {
    installAudioContext()
    const speaker = new Speaker()
    speaker.play(samples(480))

    expect(FakeAudioContext.instances).toHaveLength(1)
    const ctx = FakeAudioContext.instances[0]
    expect(ctx.resume).toHaveBeenCalled()
  })

  it('retoma o contexto suspenso via resume() explícito', async () => {
    installAudioContext()
    const speaker = new Speaker()
    await speaker.resume()

    const ctx = FakeAudioContext.instances[0]
    expect(ctx.state).toBe('running')
  })

  it('aplica o volume definido antes da criação do contexto', () => {
    installAudioContext()
    const speaker = new Speaker()
    speaker.setVolume(0.3)
    speaker.play(samples(480))

    const ctx = FakeAudioContext.instances[0]
    expect(ctx.gainNodes[0].gain.value).toBe(0.3)
  })

  it('destroy fecha o contexto', () => {
    installAudioContext()
    const speaker = new Speaker()
    speaker.play(samples(480))
    speaker.destroy()

    expect(FakeAudioContext.instances[0].closeCalls).toBe(1)
  })
})
