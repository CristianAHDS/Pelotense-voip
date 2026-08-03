import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
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

beforeEach(() => {
  resetStores()
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
})

describe('ChatPanel design (D4/D5)', () => {
  it('mostra separador de data entre mensagens de dias diferentes', () => {
    const now = Date.now()
    const day2 = now - 2 * 86400000
    useRoomStore.getState().setMessages([
      { id: 'm1', userId: 'u1', userName: 'Maria Silva', text: 'ontem', timestamp: day2 },
      { id: 'm2', userId: 'u2', userName: 'João', text: 'hoje', timestamp: now },
    ])
    const { container } = render(<ChatPanel />)
    const separators = container.querySelectorAll('.chat-date-separator')
    expect(separators.length).toBe(2)
    expect(separators[1]!.textContent).toBe('Hoje')
  })

  it('não mostra separador de data quando as mensagens são do mesmo dia', () => {
    const now = Date.now()
    useRoomStore.getState().setMessages([
      { id: 'm1', userId: 'u1', userName: 'A', text: 'um', timestamp: now - 1000 },
      { id: 'm2', userId: 'u2', userName: 'B', text: 'dois', timestamp: now },
    ])
    const { container } = render(<ChatPanel />)
    expect(container.querySelectorAll('.chat-date-separator').length).toBe(1)
  })

  it('mostra avatar com iniciais para mensagens de outros', () => {
    useRoomStore.getState().setMessages([
      { id: 'm1', userId: 'u1', userName: 'Maria Silva', text: 'olá', timestamp: Date.now() },
    ])
    const { container } = render(<ChatPanel />)
    const avatar = container.querySelector('.chat-avatar')
    expect(avatar).not.toBeNull()
    expect(avatar!.textContent).toBe('MS')
  })

  it('mostra estado vazio quando não há mensagens', () => {
    const { container } = render(<ChatPanel />)
    expect(container.querySelector('.empty-state')).not.toBeNull()
  })

  it('mostra skeleton enquanto carrega as mensagens', () => {
    useRoomStore.getState().setLoadingMessages(true)
    const { container } = render(<ChatPanel />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('exibe a hora exata como title da hora relativa', () => {
    useRoomStore.getState().setMessages([
      { id: 'm1', userId: 'u1', userName: 'A', text: 'olá', timestamp: Date.now() },
    ])
    const { container } = render(<ChatPanel />)
    const time = container.querySelector('.chat-bubble-time')
    expect(time!.getAttribute('title')).toMatch(/^\d{2}:\d{2}$/)
  })
})
