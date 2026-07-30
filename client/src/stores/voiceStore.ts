import { create } from 'zustand'
import { VoiceState } from '../types/index.ts'

interface VoiceStore extends VoiceState {
  setMuted: (muted: boolean) => void
  setVolume: (volume: number) => void
  setLevel: (level: number) => void
  toggleMute: () => void
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  muted: true,
  volume: 0.8,
  level: 0,
  setMuted: (muted) => set({ muted }),
  setVolume: (volume) => set({ volume }),
  setLevel: (level) => set({ level }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
}))
