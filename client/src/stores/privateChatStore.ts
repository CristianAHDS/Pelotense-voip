import { create } from 'zustand'
import type { PrivateChatMsg } from '../types/index.ts'

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
      const key = msg.fromUserId
      const existing = s.messages[key] ?? []
      return {
        messages: { ...s.messages, [key]: [...existing, msg] },
      }
    }),
}))
