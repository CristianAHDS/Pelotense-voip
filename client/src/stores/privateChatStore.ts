import { create } from 'zustand'
import type { PrivateChatMsg } from '../types/index.ts'
import { useConnectionStore } from './connectionStore.ts'

interface PrivateChatStore {
  activeUserId: string | null
  activeUserName: string | null
  messages: Record<string, PrivateChatMsg[]>
  unread: Record<string, boolean>
  openChat: (userId: string, userName: string) => void
  closeChat: () => void
  addMessage: (msg: PrivateChatMsg) => void
  setMessages: (userId: string, msgs: PrivateChatMsg[]) => void
}

export const usePrivateChatStore = create<PrivateChatStore>((set) => ({
  activeUserId: null,
  activeUserName: null,
  messages: {},
  unread: {},
  openChat: (userId, userName) =>
    set((s) => {
      const unread = { ...s.unread }
      delete unread[userId]
      return { activeUserId: userId, activeUserName: userName, unread }
    }),
  closeChat: () => set({ activeUserId: null, activeUserName: null }),
  setMessages: (userId, msgs) =>
    set((s) => ({ messages: { ...s.messages, [userId]: msgs } })),
  addMessage: (msg) =>
    set((s) => {
      const myId = useConnectionStore.getState().id
      const key = msg.toUserId && msg.fromUserId === myId
        ? msg.toUserId
        : msg.fromUserId
      if (!key) return s
      const existing = s.messages[key] ?? []
      const isIncoming = msg.fromUserId !== myId
      const isActive = s.activeUserId === key
      // Eco do servidor com o mesmo id (mensagem otimista): substitui no lugar,
      // limpando o marcador "enviando…". Sem id, apenas anexa.
      const replaced = msg.id && existing.some((m) => m.id === msg.id)
      const next = replaced
        ? existing.map((m) => (m.id === msg.id ? { ...msg } : m))
        : [...existing, msg]
      return {
        messages: { ...s.messages, [key]: next },
        unread: isIncoming && !isActive
          ? { ...s.unread, [key]: true }
          : s.unread,
      }
    }),
}))
