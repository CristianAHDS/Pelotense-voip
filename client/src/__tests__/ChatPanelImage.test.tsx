import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { ChatPanel } from '../components/ChatPanel.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { sendMessageReaction, sendForwardMessage } from '../services/connectionService.ts'

vi.mock('../services/connectionService.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/connectionService.ts')>()
  return {
    ...actual,
    sendMessageReaction: vi.fn(),
    sendForwardMessage: vi.fn(),
  }
})

function resetStores(): void {
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu', admin: false, reconnecting: false })
  useRoomStore.setState({
    rooms: [
      { id: 'r1', name: 'Sala', users: 2 },
      { id: 'r2', name: 'Ao vivo', users: 5 },
    ],
    users: [],
    currentRoom: 'r1',
    currentRoomName: 'Sala',
    messages: [],
    unread: {},
    loadingRooms: false,
    loadingMessages: false,
  })
  useLiveStore.setState({ broadcasters: [], chunks: [], pendingRequest: null, takeoverRequestSent: false, requestDenied: 0 })
  useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, rxLevel: 0, speaking: {} })
}

beforeEach(() => {
  resetStores()
  Element.prototype.scrollIntoView = () => {}
  ;(sendMessageReaction as unknown as ReturnType<typeof vi.fn>).mockClear()
  ;(sendForwardMessage as unknown as ReturnType<typeof vi.fn>).mockClear()
})

afterEach(() => {
  cleanup()
})

describe('Imagens (D7)', () => {
  it('renderiza thumbnail de imagem na bolha', () => {
    useRoomStore.getState().setMessages([{ id: 'm1', userId: 'u1', userName: 'Ana', imageData: 'aW1n', timestamp: Date.now() }])
    const { container } = render(<ChatPanel />)
    const img = container.querySelector('.chat-image') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toBe('data:image/jpeg;base64,aW1n')
  })

  it('abre o lightbox ao clicar na imagem e fecha com Escape', () => {
    useRoomStore.getState().setMessages([{ id: 'm1', userId: 'u1', userName: 'Ana', imageData: 'aW1n', timestamp: Date.now() }])
    const { container } = render(<ChatPanel />)
    fireEvent.click(container.querySelector('.chat-image')!)
    expect(container.querySelector('.lightbox')).not.toBeNull()
    expect((container.querySelector('.lightbox-media') as HTMLImageElement).src).toBe('data:image/jpeg;base64,aW1n')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(container.querySelector('.lightbox')).toBeNull()
  })
})

describe('Reações (D7)', () => {
  it('mostra chips de reação com contagem e marca a do usuário', () => {
    useRoomStore.getState().setMessages([{
      id: 'm1',
      userId: 'u1',
      userName: 'Ana',
      text: 'oi',
      timestamp: Date.now(),
      reactions: [
        { emoji: '👍', userIds: ['me', 'u2'] },
        { emoji: '❤️', userIds: ['u2'] },
      ],
    }])
    const { container } = render(<ChatPanel />)
    const chips = container.querySelectorAll('.chat-reaction-chip')
    expect(chips.length).toBe(2)
    expect(chips[0].textContent).toContain('👍')
    expect(chips[0].textContent).toContain('2')
    expect(chips[0].className).toContain('mine')
    expect(chips[1].className).not.toContain('mine')
  })

  it('alterna reação ao clicar no chip', () => {
    useRoomStore.getState().setMessages([{
      id: 'm1',
      userId: 'u1',
      userName: 'Ana',
      text: 'oi',
      timestamp: Date.now(),
      reactions: [{ emoji: '👍', userIds: ['u2'] }],
    }])
    const { container } = render(<ChatPanel />)
    fireEvent.click(container.querySelector('.chat-reaction-chip')!)
    expect(sendMessageReaction).toHaveBeenCalledWith('m1', '👍')
  })

  it('abre o seletor de emojis e envia a reação escolhida', () => {
    useRoomStore.getState().setMessages([{ id: 'm1', userId: 'u1', userName: 'Ana', text: 'oi', timestamp: Date.now() }])
    const { container } = render(<ChatPanel />)
    fireEvent.click(container.querySelector('.chat-reaction-add-btn')!)
    const options = container.querySelectorAll('.chat-reaction-option')
    expect(options.length).toBeGreaterThan(0)
    fireEvent.click(options[0])
    expect(sendMessageReaction).toHaveBeenCalledTimes(1)
  })

  it('não permite reagir à própria mensagem', () => {
    useRoomStore.getState().setMessages([{
      id: 'm1',
      userId: 'me',
      userName: 'Eu',
      text: 'minha mensagem',
      timestamp: Date.now(),
      reactions: [{ emoji: '👍', userIds: ['u2'] }],
    }])
    const { container } = render(<ChatPanel />)
    expect(container.querySelector('.chat-reaction-add-btn')).toBeNull()
    const chip = container.querySelector('.chat-reaction-chip') as HTMLButtonElement
    expect(chip).not.toBeNull()
    expect(chip.className).toContain('static')
    expect(chip.disabled).toBe(true)
    fireEvent.click(chip)
    expect(sendMessageReaction).not.toHaveBeenCalled()
  })
})

describe('Encaminhar (D7)', () => {
  it('abre o seletor de salas e encaminha para a escolhida', () => {
    useRoomStore.getState().setMessages([{ id: 'm1', userId: 'u1', userName: 'Ana', text: 'olá', timestamp: Date.now() }])
    const { container } = render(<ChatPanel />)
    fireEvent.click(container.querySelector('.chat-bubble-forward-btn')!)
    const picker = container.querySelector('.forward-picker')
    expect(picker).not.toBeNull()
    expect(picker!.textContent).toContain('#Ao vivo')

    const items = container.querySelectorAll('.forward-picker-item')
    fireEvent.click(items[1])
    expect(sendForwardMessage).toHaveBeenCalledWith('m1', 'Ao vivo')
    expect(container.querySelector('.forward-picker')).toBeNull()
  })
})

describe('Bot do rádio (sala Retorno ao vivo)', () => {
  it('mostra o bot de rádio na sala "Retorno ao vivo"', () => {
    useRoomStore.getState().setCurrentRoom('r1', 'Retorno ao vivo')
    const { container } = render(<ChatPanel />)
    expect(container.querySelector('.radio-bot')).not.toBeNull()
  })

  it('não mostra o bot de rádio em outras salas', () => {
    useRoomStore.getState().setCurrentRoom('r1', 'Ao vivo')
    const { container } = render(<ChatPanel />)
    expect(container.querySelector('.radio-bot')).toBeNull()
  })

  it('não mostra o bot de rádio na sala "Boletins gravados"', () => {
    useRoomStore.getState().setCurrentRoom('r1', 'Boletins gravados')
    const { container } = render(<ChatPanel />)
    expect(container.querySelector('.radio-bot')).toBeNull()
  })
})
