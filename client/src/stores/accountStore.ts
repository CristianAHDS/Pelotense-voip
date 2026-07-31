import { create } from 'zustand'

const CREDENTIALS_KEY = 'voip_credentials'
const AVATAR_KEY = 'voip_avatar'

export interface AccountPrefs {
  name: string
  email: string
  password: string
  avatar: string
}

function loadCredentials(): { name: string; email: string; password: string } {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        name: parsed.name ?? '',
        email: parsed.email ?? '',
        password: parsed.password ?? '',
      }
    }
  } catch { /* ignore */ }
  return { name: '', email: '', password: '' }
}

function loadAvatar(): string {
  try {
    return localStorage.getItem(AVATAR_KEY) ?? ''
  } catch { /* ignore */ }
  return ''
}

function persistAvatar(avatar: string): void {
  try {
    if (avatar) localStorage.setItem(AVATAR_KEY, avatar)
    else localStorage.removeItem(AVATAR_KEY)
  } catch { /* ignore */ }
}

export function clearAccountPrefs(): void {
  try {
    localStorage.removeItem(AVATAR_KEY)
  } catch { /* ignore */ }
}

export function persistCredentials(name: string, email: string, password: string): void {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ ...parsed, name, email, password }))
  } catch { /* ignore */ }
}

interface AccountStore {
  name: string
  email: string
  password: string
  avatar: string
  prefsOpen: boolean
  chatFullscreen: boolean
  setPrefs: (prefs: Partial<AccountPrefs>) => void
  savePrefs: (prefs: AccountPrefs) => void
  openPrefs: () => void
  closePrefs: () => void
  toggleFullscreen: () => void
}

const initial = loadCredentials()

export const useAccountStore = create<AccountStore>((set) => ({
  name: initial.name,
  email: initial.email,
  password: initial.password,
  avatar: loadAvatar(),
  prefsOpen: false,
  chatFullscreen: false,
  setPrefs: (prefs) =>
    set((s) => ({
      name: prefs.name ?? s.name,
      email: prefs.email ?? s.email,
      password: prefs.password ?? s.password,
      avatar: prefs.avatar ?? s.avatar,
    })),
  savePrefs: (prefs) => {
    persistAvatar(prefs.avatar)
    persistCredentials(prefs.name, prefs.email, prefs.password)
    set({ name: prefs.name, email: prefs.email, password: prefs.password, avatar: prefs.avatar })
  },
  openPrefs: () => set({ prefsOpen: true }),
  closePrefs: () => set({ prefsOpen: false }),
  toggleFullscreen: () => set((s) => ({ chatFullscreen: !s.chatFullscreen })),
}))

