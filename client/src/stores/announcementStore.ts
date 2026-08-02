import { create } from 'zustand'

export interface Announcement {
  id: string
  text: string
  expiresAt: number
}

interface AnnouncementStore {
  current: Announcement | null
  show: (id: string, text: string, durationMs: number) => void
  dismiss: () => void
}

export const useAnnouncementStore = create<AnnouncementStore>((set) => ({
  current: null,
  show: (id, text, durationMs) => set({ current: { id, text, expiresAt: Date.now() + durationMs } }),
  dismiss: () => set({ current: null }),
}))
