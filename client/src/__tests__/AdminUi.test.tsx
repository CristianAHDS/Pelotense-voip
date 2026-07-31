import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { UserList } from '../components/UserList.tsx'
import { RoomList } from '../components/RoomList.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

function resetStores(): void {
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu', admin: false, reconnecting: false })
  useRoomStore.setState({ rooms: [], users: [], currentRoom: null, currentRoomName: null, messages: [] })
  useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, rxLevel: 0, speaking: {} })
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

describe('RoomList (badge LIVE)', () => {
  it('mostra badge LIVE e nome do broadcaster quando a sala está ao vivo', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Ao vivo', users: 1, live: { userId: 'u1', userName: 'Narrador' } }])
    const { container } = render(<RoomList />)
    const item = container.querySelector('.room-item')
    expect(item?.className).toContain('room-item--live')
    const badge = container.querySelector('.room-live-badge')
    expect(badge?.textContent).toContain('LIVE')
    expect(container.querySelector('.room-live-user')?.textContent).toContain('Narrador')
  })

  it('não mostra badge LIVE sem transmissão ativa', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Externas', users: 1, live: null }])
    const { container } = render(<RoomList />)
    expect(container.querySelectorAll('.room-live-badge').length).toBe(0)
    expect(container.querySelector('.room-item')?.className).not.toContain('room-item--live')
  })
})

describe('RoomList (criador da sala)', () => {
  it('exibe "criada por <nome>" para salas temporárias', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Sala do Dono', users: 1, createdBy: 'u1', createdByName: 'Dono' }])
    const { container } = render(<RoomList />)
    expect(container.querySelector('.room-creator-name')?.textContent).toContain('criada por Dono')
  })

  it('resgata o nome do criador pela lista de usuários quando criador está online', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Sala X', users: 1, createdBy: 'u1' }])
    useRoomStore.getState().setUsers([{ id: 'u1', name: 'DonoX', room: 'r1' }])
    const { container } = render(<RoomList />)
    expect(container.querySelector('.room-creator-name')?.textContent).toContain('criada por DonoX')
  })

  it('não mostra criador em sala fixa', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Externas', users: 1, fixed: true }])
    const { container } = render(<RoomList />)
    expect(container.querySelectorAll('.room-creator').length).toBe(0)
  })
})

describe('RoomList (tooltip de ocupantes)', () => {
  it('expõe a lista completa de ocupantes no title/tooltip', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Sala', users: 3 }])
    useRoomStore.getState().setUsers([
      { id: 'u1', name: 'Ana', room: 'r1' },
      { id: 'u2', name: 'Bruno', room: 'r1' },
      { id: 'u3', name: 'Carla', room: 'r1' },
    ])
    const { container } = render(<RoomList />)
    const list = container.querySelector('.room-users-list')
    expect(list?.getAttribute('title')).toBe('Ana, Bruno, Carla')
    expect(list?.getAttribute('data-tooltip')).toContain('Carla')
  })

  it('mostra "+N" quando há mais de 5 ocupantes', () => {
    const users = Array.from({ length: 7 }, (_, i) => ({ id: `u${i}`, name: `User${i}`, room: 'r1' }))
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Sala', users: 7 }])
    useRoomStore.getState().setUsers(users)
    const { container } = render(<RoomList />)
    const more = container.querySelector('.room-user-more')
    expect(more?.textContent).toBe('+2')
  })
})

describe('RoomList (mobile colapsável)', () => {
  it('alterna o corpo da lista ao clicar no toggle', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Sala', users: 1 }])
    const { container } = render(<RoomList />)
    const body = container.querySelector('.room-list-body')
    expect(body?.className).not.toContain('room-list-body--collapsed')

    const toggle = container.querySelector('.room-list-toggle') as HTMLButtonElement
    fireEvent.click(toggle)
    expect(body?.className).toContain('room-list-body--collapsed')

    fireEvent.click(toggle)
    expect(body?.className).not.toContain('room-list-body--collapsed')
  })
})

describe('RoomList (indicador de atividade)', () => {
  it('destaca a sala quando há alguém falando nela', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Sala', users: 1 }])
    useRoomStore.getState().setUsers([{ id: 'u1', name: 'Falante', room: 'r1' }])
    useVoiceStore.getState().markSpeaking('u1')
    const { container } = render(<RoomList />)
    expect(container.querySelector('.room-item')?.className).toContain('room-item--active-voice')
  })

  it('não destaca a sala sem atividade de voz', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Sala', users: 1 }])
    useRoomStore.getState().setUsers([{ id: 'u1', name: 'Quieto', room: 'r1' }])
    const { container } = render(<RoomList />)
    expect(container.querySelector('.room-item')?.className).not.toContain('room-item--active-voice')
  })
})
