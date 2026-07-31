import { create } from 'zustand'

interface SettingsStore {
  serverHost: string
  serverWsPort: number
  setServerHost: (host: string) => void
  setServerWsPort: (port: number) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  serverHost: import.meta.env.VITE_SERVER_HOST || '192.168.8.94',
  serverWsPort: 3001,
  setServerHost: (host) => set({ serverHost: host }),
  setServerWsPort: (port) => set({ serverWsPort: port }),
}))
