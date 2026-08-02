import { create } from 'zustand'

interface OnboardingStore {
  open: boolean
  started: boolean
  show: () => void
  close: () => void
}

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  open: false,
  started: false,
  show: () => set({ open: true, started: true }),
  close: () => set({ open: false }),
}))
