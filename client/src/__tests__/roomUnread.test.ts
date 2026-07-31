import { describe, it, expect, beforeEach } from 'vitest'
import { useRoomStore } from '../stores/roomStore.ts'

describe('roomStore unread', () => {
  beforeEach(() => {
    useRoomStore.setState({
      rooms: [],
      users: [],
      currentRoom: null,
      currentRoomName: null,
      messages: [],
      unread: {},
      loadingRooms: false,
      loadingMessages: false,
    })
  })

  it('incrementa o contador de não-lidas por sala', () => {
    useRoomStore.getState().incrementUnread('r1')
    useRoomStore.getState().incrementUnread('r1')
    useRoomStore.getState().incrementUnread('r2')
    expect(useRoomStore.getState().unread).toEqual({ r1: 2, r2: 1 })
  })

  it('marca como lida e remove apenas a sala informada', () => {
    useRoomStore.getState().incrementUnread('r1')
    useRoomStore.getState().incrementUnread('r2')
    useRoomStore.getState().markRoomRead('r1')
    expect(useRoomStore.getState().unread).toEqual({ r2: 1 })
  })

  it('markRoomRead de sala sem não-lidas não altera estado', () => {
    useRoomStore.getState().incrementUnread('r1')
    const before = useRoomStore.getState().unread
    useRoomStore.getState().markRoomRead('r9')
    expect(useRoomStore.getState().unread).toBe(before)
  })

  it('clearUnread esvazia todos os contadores', () => {
    useRoomStore.getState().incrementUnread('r1')
    useRoomStore.getState().incrementUnread('r2')
    useRoomStore.getState().clearUnread()
    expect(useRoomStore.getState().unread).toEqual({})
  })

  it('controla flags de loading', () => {
    expect(useRoomStore.getState().loadingRooms).toBe(false)
    useRoomStore.getState().setLoadingRooms(true)
    expect(useRoomStore.getState().loadingRooms).toBe(true)
    useRoomStore.getState().setLoadingMessages(true)
    expect(useRoomStore.getState().loadingMessages).toBe(true)
  })
})
