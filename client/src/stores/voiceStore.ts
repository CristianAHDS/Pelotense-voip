import { create } from 'zustand'
import { VoiceState } from '../types/index.ts'

interface VoiceStore extends VoiceState {
  setMuted: (muted: boolean) => void
  setTalking: (talking: boolean) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  muted: true,
  talking: false,
  volume: 0.8,
  setMuted: (muted) => set({ muted }),
  setTalking: (talking) => set({ talking }),
  setVolume: (volume) => set({ volume }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
}))
