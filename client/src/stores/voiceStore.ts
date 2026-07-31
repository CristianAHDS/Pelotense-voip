import { create } from 'zustand'
import { VoiceState } from '../types/index.ts'

const SPEAKING_TIMEOUT_MS = 400

interface VoiceStore extends VoiceState {
  setMuted: (muted: boolean) => void
  setVolume: (volume: number) => void
  setLevel: (level: number) => void
  setRxLevel: (level: number) => void
  toggleMute: () => void
  markSpeaking: (userId: string) => void
  pruneSpeaking: () => void
  clearSpeaking: () => void
  transmitting: boolean
  setTransmitting: (transmitting: boolean) => void
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  muted: true,
  volume: 0.8,
  level: 0,
  rxLevel: 0,
  speaking: {},
  transmitting: false,
  setMuted: (muted) => set({ muted }),
  setVolume: (volume) => set({ volume }),
  setLevel: (level) => set({ level }),
  setRxLevel: (rxLevel) => set({ rxLevel }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  markSpeaking: (userId) =>
    set((s) => ({ speaking: { ...s.speaking, [userId]: Date.now() } })),
  pruneSpeaking: () =>
    set((s) => {
      const now = Date.now()
      let changed = false
      const speaking = { ...s.speaking }
      for (const [id, ts] of Object.entries(speaking)) {
        if (now - ts > SPEAKING_TIMEOUT_MS) {
          delete speaking[id]
          changed = true
        }
      }
      return changed ? { speaking } : s
    }),
  clearSpeaking: () => set({ speaking: {} }),
  setTransmitting: (transmitting) => set({ transmitting }),
}))

export { SPEAKING_TIMEOUT_MS }
