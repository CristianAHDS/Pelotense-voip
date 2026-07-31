import { create } from 'zustand'

export type ThemeMode = 'auto' | 'light' | 'dark'

const THEME_KEY = 'voip_theme'

function loadTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw
  } catch { /* ignore */ }
  return 'auto'
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  if (mode === 'auto') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', mode)
  }
}

interface SettingsStore {
  serverHost: string
  serverWsPort: number
  theme: ThemeMode
  setServerHost: (host: string) => void
  setServerWsPort: (port: number) => void
  setTheme: (theme: ThemeMode) => void
  cycleTheme: () => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  serverHost: import.meta.env.VITE_SERVER_HOST || '192.168.8.94',
  serverWsPort: 3001,
  theme: loadTheme(),
  setServerHost: (host) => set({ serverHost: host }),
  setServerWsPort: (port) => set({ serverWsPort: port }),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch { /* ignore */ }
    applyTheme(theme)
    set({ theme })
  },
  cycleTheme: () => {
    const order: ThemeMode[] = ['auto', 'light', 'dark']
    const current = get().theme
    const next = order[(order.indexOf(current) + 1) % order.length]
    get().setTheme(next)
  },
}))
