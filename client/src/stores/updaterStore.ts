import { create } from 'zustand'

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'done' | 'error'

interface UpdaterStore {
  status: UpdateStatus
  version: string | null
  error: string | null
  setChecking: () => void
  setAvailable: (version: string) => void
  setDownloading: () => void
  setDone: () => void
  setError: (error: string) => void
}

export const useUpdaterStore = create<UpdaterStore>((set) => ({
  status: 'idle',
  version: null,
  error: null,
  setChecking: () => set({ status: 'checking', version: null, error: null }),
  setAvailable: (version) => set({ status: 'available', version, error: null }),
  setDownloading: () => set({ status: 'downloading', error: null }),
  setDone: () => set({ status: 'done', error: null }),
  setError: (error) => set({ status: 'error', error }),
}))
