import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { LiveViewer } from '../components/LiveViewer.tsx'
import { useLiveStore } from '../stores/liveStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { chunkToBuffer } from '../utils/livePlayer.ts'

class FakeSourceBuffer {
  mode = 'sequence'
  appended: ArrayBuffer[] = []
  private updateend: Set<() => void> = new Set()

  addEventListener(type: string, cb: () => void): void {
    if (type === 'updateend') this.updateend.add(cb)
  }

  appendBuffer(data: ArrayBuffer): void {
    this.appended.push(data)
    queueMicrotask(() => this.updateend.forEach((cb) => cb()))
  }
}

class FakeMediaSource {
  static instances: FakeMediaSource[] = []
  static isTypeSupported = (): boolean => true

  readyState = 'open'
  sourceBuffers: FakeSourceBuffer[] = []
  private listeners: Record<string, Set<() => void>> = {}

  constructor() {
    FakeMediaSource.instances.push(this)
  }

  addEventListener(type: string, cb: () => void): void {
    if (!this.listeners[type]) this.listeners[type] = new Set()
    this.listeners[type].add(cb)
  }

  dispatch(type: string): void {
    this.listeners[type]?.forEach((cb) => cb())
  }

  addSourceBuffer(): FakeSourceBuffer {
    const sb = new FakeSourceBuffer()
    this.sourceBuffers.push(sb)
    return sb
  }

  endOfStream(): void {}
}

function resetStores(): void {
  useLiveStore.setState({ broadcaster: null, chunks: [], pendingRequest: null, takeoverRequestSent: false, requestDenied: 0 })
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu' })
}

beforeEach(() => {
  resetStores()
  FakeMediaSource.instances = []
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:fake'),
    revokeObjectURL: vi.fn(),
  })
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LiveViewer', () => {
  it('retorna null quando não há broadcaster', () => {
    const { container } = render(<LiveViewer />)
    expect(container.firstChild).toBeNull()
  })

  it('retorna null quando o broadcaster é eu mesmo', () => {
    useLiveStore.getState().setBroadcaster({ userId: 'me', userName: 'Eu' })
    const { container } = render(<LiveViewer />)
    expect(container.firstChild).toBeNull()
  })

  it('usa fallback de Blob URL quando MediaSource não existe', async () => {
    vi.stubGlobal('MediaSource', undefined)
    useLiveStore.setState({
      broadcaster: { userId: 'other', userName: 'Narrador' },
      chunks: [{ userId: 'other', chunk: 'Y2h1bms=', duration: 1 }],
    })

    render(<LiveViewer />)
    const video = document.querySelector('video.live-viewer-video') as HTMLVideoElement
    expect(video).not.toBeNull()
    expect(video.src).toContain('blob:fake')
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('inicializa MediaSource e faz append dos chunks no SourceBuffer', async () => {
    vi.stubGlobal('MediaSource', FakeMediaSource)
    useLiveStore.setState({
      broadcaster: { userId: 'other', userName: 'Narrador' },
      chunks: [{ userId: 'other', chunk: 'AQIDBA==', duration: 1 }],
    })

    await act(async () => {
      render(<LiveViewer />)
    })

    expect(FakeMediaSource.instances).toHaveLength(1)
    const ms = FakeMediaSource.instances[0]
    const video = document.querySelector('video.live-viewer-video') as HTMLVideoElement
    expect(video.src).toContain('blob:fake')

    await act(async () => {
      ms.dispatch('sourceopen')
    })

    expect(ms.sourceBuffers).toHaveLength(1)
    expect(ms.sourceBuffers[0].mode).toBe('sequence')

    await act(async () => {})
    const expected = chunkToBuffer('AQIDBA==')
    const appended = ms.sourceBuffers[0].appended
    expect(appended.length).toBeGreaterThan(0)
    const first = new Uint8Array(appended[0])
    expect(Array.from(first)).toEqual(Array.from(expected))
  })
})
