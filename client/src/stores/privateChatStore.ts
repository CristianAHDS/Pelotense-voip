import { create } from 'zustand'
import type { PrivateChatMsg } from '../types/index.ts'
import { useConnectionStore } from './connectionStore.ts'

interface PrivateChatStore {
  activeUserId: string | null
  activeUserName: string | null
  messages: Record<string, PrivateChatMsg[]>
  openChat: (userId: string, userName: string) => void
  closeChat: () => void
  addMessage: (msg: PrivateChatMsg) => void
}

export const usePrivateChatStore = create<PrivateChatStore>((set) => ({
  activeUserId: null,
  activeUserName: null,
  messages: {},
  openChat: (userId, userName) => set({ activeUserId: userId, activeUserName: userName }),
  closeChat: () => set({ activeUserId: null, activeUserName: null }),
  addMessage: (msg) =>
    set((s) => {
      const myId = useConnectionStore.getState().id
      const key = msg.toUserId && msg.fromUserId === myId
        ? msg.toUserId
        : msg.fromUserId
      if (!key) return s
      const existing = s.messages[key] ?? []
      return {
        messages: { ...s.messages, [key]: [...existing, msg] },
      }
    }),
}))
