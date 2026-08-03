import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { ChatPanel } from '../components/ChatPanel.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
function resetStores(): void {
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu', admin: false, reconnecting: false })
  useRoomStore.setState({ rooms: [], users: [], currentRoom: 'r1', currentRoomName: 'Sala', messages: [], unread: {}, loadingRooms: false, loadingMessages: false })
  useLiveStore.setState({ broadcasters: [], chunks: [], pendingRequest: null, takeoverRequestSent: false, requestDenied: 0 })
  useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, rxLevel: 0, speaking: {} })
}

function audioMsg(): any {
  return { id: 'm1', userId: 'u1', userName: 'A', audioData: 'aGVsbG8=', duration: 10, timestamp: Date.now() }
}

const rect: DOMRect = { left: 0, width: 200, top: 0, right: 200, bottom: 0, height: 28, x: 0, y: 0, toJSON: () => ({}) } as DOMRect

beforeEach(() => {
  resetStores()
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.getBoundingClientRect = () => rect
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('Player de áudio (timeline estilo WhatsApp)', () => {
  it('mostra timeline clicável com duração e posição inicial', () => {
    useRoomStore.getState().setMessages([audioMsg()])
    const { container } = render(<ChatPanel />)

    const timeline = container.querySelector('.chat-audio-progress')
    expect(timeline).not.toBeNull()
    expect(timeline!.getAttribute('role')).toBe('slider')
    expect(timeline!.getAttribute('aria-valuemax')).toBe('10')
    expect(timeline!.getAttribute('aria-valuenow')).toBe('0')

    const time = container.querySelector('.chat-audio-time')
    const duration = container.querySelector('.chat-audio-duration')
    expect(time!.textContent).toBe('0:00')
    expect(duration!.textContent).toBe('0:10')

    expect(container.querySelectorAll('.chat-audio-bar').length).toBe(32)
    expect(container.querySelectorAll('.chat-audio-bar--active').length).toBe(0)
  })

  it('busca ao clicar na timeline (50% -> 0:05)', () => {
    useRoomStore.getState().setMessages([audioMsg()])
    const { container } = render(<ChatPanel />)

    const timeline = container.querySelector('.chat-audio-progress')!
    fireEvent.pointerDown(timeline, { clientX: 100 })

    expect(timeline.getAttribute('aria-valuenow')).toBe('5')
    expect(container.querySelector('.chat-audio-time')!.textContent).toBe('0:05')

    const active = container.querySelectorAll('.chat-audio-bar--active')
    expect(active.length).toBeGreaterThan(0)
    expect(active.length).toBeLessThan(32)
  })

  it('busca com setas do teclado em passos de 5s', () => {
    useRoomStore.getState().setMessages([audioMsg()])
    const { container } = render(<ChatPanel />)

    const timeline = container.querySelector('.chat-audio-progress')!
    fireEvent.keyDown(timeline, { key: 'ArrowRight' })

    expect(timeline.getAttribute('aria-valuenow')).toBe('5')
    expect(container.querySelector('.chat-audio-time')!.textContent).toBe('0:05')
  })

  it('oferece botão de download para mensagens de áudio', () => {
    useRoomStore.getState().setMessages([audioMsg()])
    const { container } = render(<ChatPanel />)
    const btn = container.querySelector('.chat-audio-download-btn')
    expect(btn).not.toBeNull()
    expect(btn!.getAttribute('aria-label')).toBe('Baixar')
  })

  it('controles ficam em linha acima da timeline', () => {
    useRoomStore.getState().setMessages([audioMsg()])
    const { container } = render(<ChatPanel />)

    const controls = container.querySelector('.chat-audio-controls')
    const timeline = container.querySelector('.chat-audio-progress')
    expect(controls).not.toBeNull()
    expect(timeline).not.toBeNull()
    expect(controls!.querySelector('.chat-audio-play-btn')).not.toBeNull()
    expect(controls!.querySelector('.chat-audio-rate-btn')).not.toBeNull()
    expect(controls!.querySelector('.chat-audio-download-btn')).not.toBeNull()
    expect(controls!.nextElementSibling).toBe(timeline)
  })
})
