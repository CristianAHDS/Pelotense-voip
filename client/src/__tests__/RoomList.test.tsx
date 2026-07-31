import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { RoomList } from '../components/RoomList.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

function resetStores(): void {
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu', admin: false, reconnecting: false })
  useRoomStore.setState({ rooms: [], users: [], currentRoom: null, currentRoomName: null, messages: [], unread: {}, loadingRooms: false, loadingMessages: false })
  useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, rxLevel: 0, speaking: {} })
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  cleanup()
})

describe('RoomList design (D5/D16)', () => {
  it('mostra badge de não-lidas por sala', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Ao vivo', users: 2 }])
    useRoomStore.getState().incrementUnread('r1')
    useRoomStore.getState().incrementUnread('r1')
    useRoomStore.getState().incrementUnread('r1')
    const { container } = render(<RoomList />)
    const badge = container.querySelector('.room-unread-badge')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toBe('3')
  })

  it('não mostra badge sem não-lidas', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Ao vivo', users: 2 }])
    const { container } = render(<RoomList />)
    expect(container.querySelector('.room-unread-badge')).toBeNull()
  })

  it('mostra skeleton enquanto carrega as salas', () => {
    useRoomStore.getState().setLoadingRooms(true)
    const { container } = render(<RoomList />)
    expect(container.querySelector('.skeleton-list')).not.toBeNull()
  })

  it('mostra estado vazio com CTA quando não há salas', () => {
    render(<RoomList />)
    expect(screen.getByText('Nenhuma sala ainda')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar sala' })).toBeInTheDocument()
  })

  it('mostra avatar de ocupantes com iniciais', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Sala 1', users: 1 }])
    useRoomStore.getState().setUsers([{ id: 'u1', name: 'Ana Clara', room: 'r1' }])
    const { container } = render(<RoomList />)
    const avatar = container.querySelector('.room-user-avatar')
    expect(avatar).not.toBeNull()
    expect(avatar!.textContent).toBe('A')
  })

  it('foco no input de criar ao clicar no CTA', () => {
    render(<RoomList />)
    fireEvent.click(screen.getByRole('button', { name: 'Criar sala' }))
    const input = screen.getByPlaceholderText('Room name') as HTMLInputElement
    expect(document.activeElement).toBe(input)
  })
})

describe('RoomList (indicador da sala atual)', () => {
  it('mostra badge "Você está aqui" na sala atual', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Ao vivo', users: 2 }])
    useRoomStore.getState().setCurrentRoom('r1', 'Ao vivo')
    const { container } = render(<RoomList />)
    expect(container.querySelector('.room-current-badge')).not.toBeNull()
    expect(container.querySelector('.room-current-badge')!.textContent).toBe('Você está aqui')
  })

  it('não mostra badge sem sala atual', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Ao vivo', users: 2 }])
    const { container } = render(<RoomList />)
    expect(container.querySelector('.room-current-badge')).toBeNull()
  })

  it('aplica a classe de animação de entrada ao entrar na sala', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Ao vivo', users: 2 }])
    useRoomStore.getState().setCurrentRoom('r1', 'Ao vivo')
    const { container } = render(<RoomList />)
    expect(container.querySelector('.room-item')?.className).toContain('room-item--entering')
    expect(container.querySelector('.room-item')?.className).toContain('active')
  })

  it('remove a classe de animação depois do tempo de entrada', () => {
    vi.useFakeTimers()
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Ao vivo', users: 2 }])
    useRoomStore.getState().setCurrentRoom('r1', 'Ao vivo')
    const { container } = render(<RoomList />)
    expect(container.querySelector('.room-item')?.className).toContain('room-item--entering')

    act(() => vi.advanceTimersByTime(800))
    expect(container.querySelector('.room-item')?.className).not.toContain('room-item--entering')
    vi.useRealTimers()
  })
})
