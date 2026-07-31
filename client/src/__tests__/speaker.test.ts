import { describe, it, expect, afterEach, vi } from 'vitest'
import { Speaker } from '../audio/speaker.ts'

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state = 'suspended'
  currentTime = 0
  gainNodes: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn> }> = []
  sources: any[] = []
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
    const node = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }
    this.gainNodes.push(node)
    return node
  }

  createDynamicsCompressor(): any {
    return { connect: vi.fn(), disconnect: vi.fn() }
  }

  createBuffer(_channels: number, length: number): any {
    const data = new Float32Array(length)
    return { getChannelData: () => data }
  }

  createBufferSource(): any {
    const source = {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    }
    this.sources.push(source)
    return source
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

function lastSource(): any {
  const ctx = FakeAudioContext.instances[0]
  return ctx.sources[ctx.sources.length - 1]
}

describe('Speaker', () => {
  it('retoma o contexto suspenso (autoplay) ao reproduzir', () => {
    installAudioContext()
    const speaker = new Speaker()
    speaker.play('u1', samples(480))

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
    speaker.play('u1', samples(480))

    const ctx = FakeAudioContext.instances[0]
    expect(ctx.gainNodes[0].gain.value).toBe(0.3)
  })

  it('destroy fecha o contexto', () => {
    installAudioContext()
    const speaker = new Speaker()
    speaker.play('u1', samples(480))
    speaker.destroy()

    expect(FakeAudioContext.instances[0].closeCalls).toBe(1)
  })

  it('frames do mesmo usuário são contínuos (sem sobreposição)', () => {
    installAudioContext()
    const speaker = new Speaker()
    speaker.play('u1', samples(480)) // 10ms
    speaker.play('u1', samples(480)) // 10ms

    const ctx = FakeAudioContext.instances[0]
    expect(ctx.sources).toHaveLength(2)
    const first = ctx.sources[0].start.mock.calls[0][0] as number
    const second = ctx.sources[1].start.mock.calls[0][0] as number
    expect(first).toBe(0)
    expect(second).toBeCloseTo(first + 480 / 48000, 5)
  })

  it('falantes diferentes têm linhas do tempo independentes (mix real)', () => {
    installAudioContext()
    const speaker = new Speaker()
    speaker.play('u1', samples(480))
    speaker.play('u2', samples(480))

    const ctx = FakeAudioContext.instances[0]
    expect(ctx.sources).toHaveLength(2)
    const a = ctx.sources[0].start.mock.calls[0][0] as number
    const b = ctx.sources[1].start.mock.calls[0][0] as number
    // Ambos começam no mesmo instante e tocam sobrepostos: o nó de ganho soma
    // os sinais, em vez de um esperar o outro (que causava o chiado).
    expect(a).toBe(0)
    expect(b).toBe(0)
  })

  it('jitter de um falante não atrasa os demais', () => {
    installAudioContext()
    const speaker = new Speaker()
    speaker.play('u1', samples(480))
    const ctx = FakeAudioContext.instances[0]

    speaker.play('u2', samples(480))
    speaker.play('u1', samples(480))
    expect(ctx.sources).toHaveLength(3)

    // u2 atrasou (timeline dele está atrás do relógio) → ressincroniza só ele
    ctx.currentTime = 0.015
    speaker.play('u2', samples(480))
    const u2Start = ctx.sources[3].start.mock.calls[0][0] as number
    expect(u2Start).toBe(0.015)

    // u1 ainda tem áudio agendado à frente (0.02) → continua intacto
    speaker.play('u1', samples(480))
    const u1Start = ctx.sources[4].start.mock.calls[0][0] as number
    expect(u1Start).toBe(0.02)
  })

  it('flush para fontes e limpa as linhas do tempo', () => {
    installAudioContext()
    const speaker = new Speaker()
    speaker.play('u1', samples(480))
    speaker.play('u2', samples(480))
    speaker.flush()

    const ctx = FakeAudioContext.instances[0]
    for (const source of ctx.sources) {
      expect(source.stop).toHaveBeenCalled()
    }

    // Após o flush, um novo frame agenda do zero
    speaker.play('u1', samples(480))
    expect(ctx.sources[2].start.mock.calls[0][0]).toBe(0)
  })
})
