import { create } from 'zustand'
import { RoomInfo, UserInfo, ChatMsg } from '../types/index.ts'

interface RoomStore {
  rooms: RoomInfo[]
  users: UserInfo[]
  currentRoom: string | null
  currentRoomName: string | null
  messages: ChatMsg[]
  setRooms: (rooms: RoomInfo[]) => void
  setUsers: (users: UserInfo[]) => void
  setCurrentRoom: (roomId: string | null, roomName?: string | null) => void
  addUser: (user: UserInfo) => void
  removeUser: (userId: string) => void
  addMessage: (msg: ChatMsg) => void
  removeMessage: (messageId: string) => void
  setMessages: (msgs: ChatMsg[]) => void
  clearMessages: () => void
}

export const useRoomStore = create<RoomStore>((set) => ({
  rooms: [],
  users: [],
  currentRoom: null,
  currentRoomName: null,
  messages: [],
  setRooms: (rooms) => set({ rooms }),
  setUsers: (users) => set({ users }),
  setCurrentRoom: (roomId, roomName) =>
    set({ currentRoom: roomId, currentRoomName: roomName ?? null }),
  addUser: (user) => set((s) => ({ users: [...s.users.filter((u) => u.id !== user.id), user] })),
  removeUser: (userId) =>
    set((s) => ({ users: s.users.filter((u) => u.id !== userId) })),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  removeMessage: (messageId) => set((s) => ({ messages: s.messages.filter((m) => m.id !== messageId) })),
  setMessages: (msgs) => set({ messages: msgs }),
  clearMessages: () => set({ messages: [] }),
}))
