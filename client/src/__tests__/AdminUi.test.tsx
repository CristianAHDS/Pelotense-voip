import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { UserList } from '../components/UserList.tsx'
import { RoomList } from '../components/RoomList.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

function resetStores(): void {
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu', admin: false, reconnecting: false })
  useRoomStore.setState({ rooms: [], users: [], currentRoom: null, currentRoomName: null, messages: [] })
  useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, speaking: {} })
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  cleanup()
})

describe('UserList (admin)', () => {
  it('exibe badge Admin para usuário marcado como admin', () => {
    useRoomStore.getState().setUsers([
      { id: 'u1', name: 'Chefe', room: 'Externas', admin: true },
      { id: 'u2', name: 'Comum', room: 'Externas', admin: false },
    ])
    const { container } = render(<UserList />)
    const badges = container.querySelectorAll('.user-admin-badge')
    expect(badges.length).toBe(1)
    expect(badges[0].textContent).toBe('Admin')
  })

  it('não exibe badge Admin para usuários comuns', () => {
    useRoomStore.getState().setUsers([{ id: 'u1', name: 'Comum', room: null }])
    const { container } = render(<UserList />)
    expect(container.querySelectorAll('.user-admin-badge').length).toBe(0)
  })

  it('destaca quem está falando', () => {
    useRoomStore.getState().setUsers([{ id: 'u1', name: 'Comum', room: null }])
    useVoiceStore.getState().markSpeaking('u1')
    const { container } = render(<UserList />)
    const item = container.querySelector('.user-item')
    expect(item?.className).toContain('user-item--speaking')
  })
})

describe('RoomList (permissão de delete)', () => {
  it('mostra botão Delete para o criador da sala', () => {
    useConnectionStore.getState().setConnected('me', 'Eu', false)
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Minha Sala', users: 1, createdBy: 'me' }])
    const { container } = render(<RoomList />)
    expect(container.querySelectorAll('.btn-delete-room').length).toBe(1)
  })

  it('oculta botão Delete para quem não é criador nem admin', () => {
    useConnectionStore.getState().setConnected('me', 'Eu', false)
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Sala Alheia', users: 1, createdBy: 'outro' }])
    const { container } = render(<RoomList />)
    expect(container.querySelectorAll('.btn-delete-room').length).toBe(0)
  })

  it('mostra botão Delete para admin mesmo sem ser criador', () => {
    useConnectionStore.getState().setConnected('me', 'Eu', true)
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Sala Alheia', users: 1, createdBy: 'outro' }])
    const { container } = render(<RoomList />)
    expect(container.querySelectorAll('.btn-delete-room').length).toBe(1)
  })

  it('nunca mostra botão Delete em sala fixa', () => {
    useConnectionStore.getState().setConnected('me', 'Eu', true)
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Externas', users: 1, fixed: true }])
    const { container } = render(<RoomList />)
    expect(container.querySelectorAll('.btn-delete-room').length).toBe(0)
  })
})
