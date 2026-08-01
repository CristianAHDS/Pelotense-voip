import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { LiveViewer } from '../components/LiveViewer.tsx'
import { useLiveStore } from '../stores/liveStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import * as liveRtc from '../services/liveRtc.ts'

vi.mock('../services/liveRtc.ts', () => ({
  startViewing: vi.fn(() => {
    const unsubscribe = vi.fn()
    return unsubscribe
  }),
  stopViewing: vi.fn(),
  initRtc: vi.fn(),
  handleSignal: vi.fn(),
  isBroadcasting: vi.fn(() => false),
  cleanup: vi.fn(),
}))

const mockLiveRtc = vi.mocked(liveRtc)

function resetStores(): void {
  useLiveStore.setState({ broadcaster: null, chunks: [], mime: null, myMime: null, pendingRequest: null, takeoverRequestSent: false, requestDenied: 0 })
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu' })
}

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
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
    expect(mockLiveRtc.startViewing).not.toHaveBeenCalled()
  })

  it('inicia a visualização WebRTC ao receber live de outro', () => {
    useLiveStore.getState().setBroadcaster({ userId: 'other', userName: 'Narrador' })
    render(<LiveViewer />)
    expect(mockLiveRtc.startViewing).toHaveBeenCalledWith('other', expect.any(Function))
  })

  it('anexa o stream remoto ao <video> quando chega', () => {
    useLiveStore.getState().setBroadcaster({ userId: 'other', userName: 'Narrador' })
    render(<LiveViewer />)
    const onStream = mockLiveRtc.startViewing.mock.calls[0][1]
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream
    onStream(fakeStream)
    const video = document.querySelector('video.live-viewer-video') as HTMLVideoElement
    expect(video.srcObject).toBe(fakeStream)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('para a visualização ao desmontar', () => {
    useLiveStore.getState().setBroadcaster({ userId: 'other', userName: 'Narrador' })
    const { unmount } = render(<LiveViewer />)
    const unsubscribe = mockLiveRtc.startViewing.mock.results[0].value
    expect(unsubscribe).toBeTypeOf('function')
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
