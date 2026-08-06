import { create } from 'zustand'
import type { PrivateChatMsg } from '../types/index.ts'
import { useConnectionStore } from './connectionStore.ts'

const ACTIVE_DM_KEY = 'voip.activeDm'

function loadActiveDm(): { userId: string | null; userName: string | null } {
  try {
    const raw = localStorage.getItem(ACTIVE_DM_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.userId === 'string') {
        return { userId: parsed.userId, userName: parsed.userName ?? null }
      }
    }
  } catch { /* ignore */ }
  return { userId: null, userName: null }
}

function persistActiveDm(userId: string | null, userName: string | null): void {
  try {
    if (!userId) {
      localStorage.removeItem(ACTIVE_DM_KEY)
    } else {
      localStorage.setItem(ACTIVE_DM_KEY, JSON.stringify({ userId, userName }))
    }
  } catch { /* ignore */ }
}

const restored = loadActiveDm()

interface PrivateChatStore {
  activeUserId: string | null
  activeUserName: string | null
  messages: Record<string, PrivateChatMsg[]>
  unread: Record<string, boolean>
  openChat: (userId: string, userName: string) => void
  closeChat: () => void
  addMessage: (msg: PrivateChatMsg) => void
  removeMessage: (messageId: string) => void
  markMessageFailed: (messageId: string) => void
  setMessages: (userId: string, msgs: PrivateChatMsg[]) => void
  updateMessage: (msg: PrivateChatMsg) => void
}

export const usePrivateChatStore = create<PrivateChatStore>((set) => ({
  activeUserId: restored.userId,
  activeUserName: restored.userName,
  messages: {},
  unread: {},
  openChat: (userId, userName) =>
    set((s) => {
      persistActiveDm(userId, userName)
      const unread = { ...s.unread }
      delete unread[userId]
      return { activeUserId: userId, activeUserName: userName, unread }
    }),
  closeChat: () => {
    persistActiveDm(null, null)
    set({ activeUserId: null, activeUserName: null })
  },
  setMessages: (userId, msgs) =>
    set((s) => ({ messages: { ...s.messages, [userId]: msgs } })),
  removeMessage: (messageId) =>
    set((s) => {
      const messages = Object.fromEntries(
        Object.entries(s.messages).map(([k, list]) => [k, list.filter((m) => m.id !== messageId)])
      )
      return { messages }
    }),
  markMessageFailed: (messageId) =>
    set((s) => {
      const messages = Object.fromEntries(
        Object.entries(s.messages).map(([k, list]) => [
          k,
          list.map((m) => (m.id === messageId ? { ...m, failed: true, sending: false } : m)),
        ])
      )
      return { messages }
    }),
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
  updateMessage: (msg) =>
    set((s) => {
      if (!msg.id) return s
      const messages = Object.fromEntries(
        Object.entries(s.messages).map(([k, list]) => [
          k,
          list.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)),
        ])
      )
      return { messages }
    }),
}))
