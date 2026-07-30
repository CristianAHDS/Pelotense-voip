import { useCallback } from 'react'
import { useRoomStore } from '../stores/roomStore.ts'
import {
  joinRoom,
  leaveRoom,
  createRoom,
} from '../services/connectionService.ts'

export function useRooms() {
  const { rooms, users, currentRoom, currentRoomName } = useRoomStore()

  const join = useCallback((roomName: string) => {
    joinRoom(roomName)
  }, [])

  const leave = useCallback(() => {
    leaveRoom()
  }, [])

  const create = useCallback((roomName: string) => {
    createRoom(roomName)
  }, [])

  return { rooms, users, currentRoom, currentRoomName, join, leave, create }
}
