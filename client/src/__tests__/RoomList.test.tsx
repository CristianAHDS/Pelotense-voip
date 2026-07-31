import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
