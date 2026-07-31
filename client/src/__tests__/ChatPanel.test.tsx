import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ChatPanel } from '../components/ChatPanel.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

function resetStores(): void {
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu', admin: false, reconnecting: false })
  useRoomStore.setState({ rooms: [], users: [], currentRoom: 'r1', currentRoomName: 'Sala', messages: [] })
  useLiveStore.setState({ broadcaster: null, chunks: [], pendingRequest: null, takeoverRequestSent: false, requestDenied: 0 })
  useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, rxLevel: 0, speaking: {} })
}

function textMsg(fromUserId: string): any {
  return { id: `m-${fromUserId}`, userId: fromUserId, userName: fromUserId, text: 'olá', timestamp: Date.now() }
}

beforeEach(() => {
  resetStores()
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
})

describe('ChatPanel (permissão de apagar mensagem)', () => {
  it('mostra botão de apagar para admin em mensagem de outro usuário', () => {
    useConnectionStore.getState().setConnected('me', 'Eu', true)
    useRoomStore.getState().setMessages([textMsg('outro')])
    const { container } = render(<ChatPanel />)
    const buttons = container.querySelectorAll('.chat-bubble-delete-btn')
    expect(buttons.length).toBe(1)
  })

  it('oculta botão de apagar para não-admin em mensagem de outro usuário', () => {
    useConnectionStore.getState().setConnected('me', 'Eu', false)
    useRoomStore.getState().setMessages([textMsg('outro')])
    const { container } = render(<ChatPanel />)
    expect(container.querySelectorAll('.chat-bubble-delete-btn').length).toBe(0)
  })

  it('mostra botão de apagar para o autor da própria mensagem', () => {
    useConnectionStore.getState().setConnected('me', 'Eu', false)
    useRoomStore.getState().setMessages([textMsg('me')])
    const { container } = render(<ChatPanel />)
    expect(container.querySelectorAll('.chat-bubble-delete-btn').length).toBe(1)
  })
})
