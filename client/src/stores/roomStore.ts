import { create } from 'zustand'
import { RoomInfo, UserInfo, ChatMsg, AccountInfo } from '../types/index.ts'

const CURRENT_ROOM_KEY = 'voip.currentRoom'

function loadCurrentRoom(): { currentRoom: string | null; currentRoomName: string | null } {
  try {
    const raw = localStorage.getItem(CURRENT_ROOM_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.roomId === 'string') {
        return { currentRoom: parsed.roomId, currentRoomName: parsed.roomName ?? null }
      }
    }
  } catch { /* ignore */ }
  return { currentRoom: null, currentRoomName: null }
}

function persistCurrentRoom(roomId: string | null, roomName: string | null): void {
  try {
    if (!roomId) {
      localStorage.removeItem(CURRENT_ROOM_KEY)
    } else {
      localStorage.setItem(CURRENT_ROOM_KEY, JSON.stringify({ roomId, roomName }))
    }
  } catch { /* ignore */ }
}

const restored = loadCurrentRoom()

interface RoomStore {
  rooms: RoomInfo[]
  users: UserInfo[]
  accounts: AccountInfo[]
  currentRoom: string | null
  currentRoomName: string | null
  messages: ChatMsg[]
  unread: Record<string, number>
  typing: Record<string, string>
  loadingRooms: boolean
  loadingMessages: boolean
  hasMoreMessages: boolean
  isLoadingMore: boolean
  setRooms: (rooms: RoomInfo[]) => void
  setUsers: (users: UserInfo[]) => void
  setAccounts: (accounts: AccountInfo[]) => void
  setCurrentRoom: (roomId: string | null, roomName?: string | null) => void
  addUser: (user: UserInfo) => void
  removeUser: (userId: string) => void
  addMessage: (msg: ChatMsg) => void
  removeMessage: (messageId: string) => void
  markMessageFailed: (messageId: string) => void
  setMessages: (msgs: ChatMsg[]) => void
  prependMessages: (msgs: ChatMsg[]) => void
  updateMessage: (msg: ChatMsg) => void
  clearMessages: () => void
  setHasMoreMessages: (v: boolean) => void
  setLoadingMore: (v: boolean) => void
  incrementUnread: (roomId: string) => void
  markRoomRead: (roomId: string) => void
  clearUnread: () => void
  setTypingUser: (userId: string, userName: string) => void
  removeTypingUser: (userId: string) => void
  clearTyping: () => void
  setLoadingRooms: (loading: boolean) => void
  setLoadingMessages: (loading: boolean) => void
}

export const useRoomStore = create<RoomStore>((set) => ({
  rooms: [],
  users: [],
  accounts: [],
  currentRoom: restored.currentRoom,
  currentRoomName: restored.currentRoomName,
  messages: [],
  unread: {},
  typing: {},
  loadingRooms: false,
  loadingMessages: false,
  hasMoreMessages: false,
  isLoadingMore: false,
  setRooms: (rooms) => set({ rooms }),
  setUsers: (users) => set({ users }),
  setAccounts: (accounts) => set({ accounts }),
  setCurrentRoom: (roomId, roomName) => {
    persistCurrentRoom(roomId, roomName ?? null)
    set({ currentRoom: roomId, currentRoomName: roomName ?? null })
  },
  addUser: (user) => set((s) => ({ users: [...s.users.filter((u) => u.id !== user.id), user] })),
  removeUser: (userId) =>
    set((s) => ({ users: s.users.filter((u) => u.id !== userId) })),
  addMessage: (msg) =>
    set((s) => {
      // Eco do servidor com o mesmo id (mensagem otimista): substitui no lugar,
      // limpando o marcador "enviando…". Sem id, apenas anexa.
      if (msg.id && s.messages.some((m) => m.id === msg.id)) {
        return { messages: s.messages.map((m) => (m.id === msg.id ? { ...msg } : m)) }
      }
      return { messages: [...s.messages, msg] }
    }),
  removeMessage: (messageId) => set((s) => ({ messages: s.messages.filter((m) => m.id !== messageId) })),
  markMessageFailed: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, failed: true, sending: false } : m
      ),
    })),
  setMessages: (msgs) => set({ messages: msgs }),
  prependMessages: (msgs) => set((s) => ({ messages: [...msgs, ...s.messages] })),
  updateMessage: (msg) =>
    set((s) => ({
      messages: msg.id
        ? s.messages.map((m) => (m.id === msg.id ? { ...m, ...msg, filePending: false } : m))
        : s.messages,
    })),
  clearMessages: () => set({ messages: [] }),
  setHasMoreMessages: (v) => set({ hasMoreMessages: v }),
  setLoadingMore: (v) => set({ isLoadingMore: v }),
  incrementUnread: (roomId) =>
    set((s) => ({
      unread: { ...s.unread, [roomId]: (s.unread[roomId] ?? 0) + 1 },
    })),
  markRoomRead: (roomId) =>
    set((s) => {
      if (!(roomId in s.unread)) return s
      const unread = { ...s.unread }
      delete unread[roomId]
      return { unread }
    }),
  clearUnread: () => set({ unread: {} }),
  setTypingUser: (userId, userName) =>
    set((s) => ({ typing: { ...s.typing, [userId]: userName } })),
  removeTypingUser: (userId) =>
    set((s) => {
      if (!(userId in s.typing)) return s
      const typing = { ...s.typing }
      delete typing[userId]
      return { typing }
    }),
  clearTyping: () => set({ typing: {} }),
  setLoadingRooms: (loading) => set({ loadingRooms: loading }),
  setLoadingMessages: (loading) => set({ loadingMessages: loading }),
}))
