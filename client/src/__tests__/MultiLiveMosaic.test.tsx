import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MultiLiveMosaic } from '../components/MultiLiveMosaic.tsx'
import { useLiveStore } from '../stores/liveStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useToastStore } from '../stores/toastStore.ts'

vi.mock('../hooks/useVideoRecorder.ts', () => ({
  useVideoRecorder: () => ({
    recording: false,
    duration: 0,
    hasStream: false,
    streamVersion: 0,
    streamRef: { current: null },
    devices: [],
    cameraId: '',
    setCameraId: vi.fn(),
    openCamera: vi.fn().mockResolvedValue(true),
    beginRecording: vi.fn().mockResolvedValue(null),
    stopRecording: vi.fn(),
    cancelRecording: vi.fn(),
    closeCamera: vi.fn(),
    enumerateDevices: vi.fn().mockResolvedValue([]),
    switchCamera: vi.fn(),
    flipCamera: vi.fn().mockResolvedValue(true),
  }),
}))

vi.mock('../services/liveRtc.ts', () => ({
  startBroadcast: vi.fn(),
  stopBroadcast: vi.fn(),
  startViewing: vi.fn(() => () => {}),
  stopViewing: vi.fn(),
  initRtc: vi.fn(),
  handleSignal: vi.fn(),
  isBroadcasting: vi.fn(() => false),
  cleanup: vi.fn(),
}))

vi.mock('../services/connectionService.ts', () => ({
  sendLiveStart: vi.fn(),
  sendLiveStop: vi.fn(),
}))

vi.mock('../audio/audioMeter.ts', () => ({
  createStreamLevel: vi.fn(() => () => {}),
  attachMediaStream: vi.fn(),
  markActive: vi.fn(),
}))

const deviceMock = vi.hoisted(() => ({ isMobileDevice: vi.fn(() => false) }))
vi.mock('../utils/device.ts', () => ({
  isMobileDevice: () => deviceMock.isMobileDevice(),
  getDeviceId: () => 'dev-test',
}))

function resetStores(): void {
  useLiveStore.setState({ broadcasters: [], chunks: [], mime: null, myMime: null, pendingRequest: null, takeoverRequestSent: false, requestDenied: 0 })
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu', settings: useConnectionStore.getState().settings })
  useRoomStore.setState({
    rooms: [],     users: [{ id: 'me', name: 'Eu', room: 'live' }],
    accounts: [], currentRoom: 'live', currentRoomName: 'live', messages: [], unread: {}, typing: {},
    loadingRooms: false, loadingMessages: false,
  })
  useToastStore.setState({ toasts: [] })
}

const mediaQueryMock = vi.hoisted(() => {
  const listeners: Array<(e: { matches: boolean }) => void> = []
  return {
    listeners,
    matches: false,
    setMatches(v: boolean): void {
      mediaQueryMock.matches = v
      for (const fn of mediaQueryMock.listeners) fn({ matches: v })
    },
  }
})

function stubMatchMedia(): void {
  const mql = {
    get matches() {
      return mediaQueryMock.matches
    },
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
      mediaQueryMock.listeners.push(fn)
    },
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
      const i = mediaQueryMock.listeners.indexOf(fn)
      if (i >= 0) mediaQueryMock.listeners.splice(i, 1)
    },
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
}

beforeEach(() => {
  resetStores()
  deviceMock.isMobileDevice.mockReturnValue(false)
  mediaQueryMock.matches = false
  mediaQueryMock.listeners.length = 0
  stubMatchMedia()
  vi.clearAllMocks()
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MultiLiveMosaic auto fullscreen no mobile', () => {
  it('não aplica overlay em desktop mesmo transmitindo em paisagem', () => {
    deviceMock.isMobileDevice.mockReturnValue(false)
    useLiveStore.getState().addBroadcaster({ userId: 'me', userName: 'Eu' })
    mediaQueryMock.setMatches(true)
    const { container } = render(<MultiLiveMosaic />)
    expect(container.querySelector('.mosaic-tile--auto-fs')).toBeNull()
  })

  it('aplica overlay de tela cheia ao girar para paisagem transmitindo', () => {
    deviceMock.isMobileDevice.mockReturnValue(true)
    useLiveStore.getState().addBroadcaster({ userId: 'me', userName: 'Eu' })
    const { container } = render(<MultiLiveMosaic />)
    expect(container.querySelector('.mosaic-tile--auto-fs')).toBeNull()
    act(() => {
      mediaQueryMock.setMatches(true)
    })
    expect(container.querySelector('.mosaic-tile--auto-fs')).not.toBeNull()
  })

  it('remove o overlay ao voltar para retrato', () => {
    deviceMock.isMobileDevice.mockReturnValue(true)
    useLiveStore.getState().addBroadcaster({ userId: 'me', userName: 'Eu' })
    const { container } = render(<MultiLiveMosaic />)
    act(() => {
      mediaQueryMock.setMatches(true)
    })
    expect(container.querySelector('.mosaic-tile--auto-fs')).not.toBeNull()
    act(() => {
      mediaQueryMock.setMatches(false)
    })
    expect(container.querySelector('.mosaic-tile--auto-fs')).toBeNull()
  })

  it('não aplica overlay em paisagem quando não está transmitindo', () => {
    deviceMock.isMobileDevice.mockReturnValue(true)
    useLiveStore.getState().addBroadcaster({ userId: 'other', userName: 'Outro' })
    const { container } = render(<MultiLiveMosaic />)
    act(() => {
      mediaQueryMock.setMatches(true)
    })
    expect(container.querySelector('.mosaic-tile--auto-fs')).toBeNull()
  })

  it('exibe botão para sair do overlay de tela cheia', () => {
    deviceMock.isMobileDevice.mockReturnValue(true)
    useLiveStore.getState().addBroadcaster({ userId: 'me', userName: 'Eu' })
    const { container } = render(<MultiLiveMosaic />)
    act(() => {
      mediaQueryMock.setMatches(true)
    })
    const closeBtn = container.querySelector<HTMLButtonElement>('.mosaic-tile--auto-fs .mosaic-tile-actions button')
    expect(closeBtn).not.toBeNull()
    act(() => {
      closeBtn?.click()
    })
    expect(container.querySelector('.mosaic-tile--auto-fs')).toBeNull()
  })
})
