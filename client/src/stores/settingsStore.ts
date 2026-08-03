import { create } from 'zustand'

export type ThemeMode = 'auto' | 'light' | 'dark'
export type Language = 'pt' | 'en'

const THEME_KEY = 'voip_theme'
const LANGUAGE_KEY = 'voip.language'

function loadTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw
  } catch { /* ignore */ }
  return 'auto'
}

function loadLanguage(): Language {
  if (typeof localStorage === 'undefined') return 'pt'
  return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'pt'
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
  theme: ThemeMode
  language: Language
  setTheme: (theme: ThemeMode) => void
  cycleTheme: () => void
  setLanguage: (lang: Language) => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  theme: loadTheme(),
  language: loadLanguage(),
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
  setLanguage: (lang) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LANGUAGE_KEY, lang)
    }
    set({ language: lang })
  },
}))
