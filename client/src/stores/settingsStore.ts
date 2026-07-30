import { create } from 'zustand'

interface SettingsStore {
  pushToTalk: boolean
  pushToTalkKey: string
  serverHost: string
  serverWsPort: number
  setPushToTalk: (enabled: boolean) => void
  setPushToTalkKey: (key: string) => void
  setServerHost: (host: string) => void
  setServerWsPort: (port: number) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  pushToTalk: false,
  pushToTalkKey: 'Space',
  serverHost: import.meta.env.VITE_SERVER_HOST || 'localhost',
  serverWsPort: 3001,
  setPushToTalk: (enabled) => set({ pushToTalk: enabled }),
  setPushToTalkKey: (key) => set({ pushToTalkKey: key }),
  setServerHost: (host) => set({ serverHost: host }),
  setServerWsPort: (port) => set({ serverWsPort: port }),
}))
