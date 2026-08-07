import { create } from 'zustand'

const CREDENTIALS_KEY = 'voip_credentials'
const AVATAR_KEY = 'voip_avatar'
const STATUS_KEY = 'voip_status'
const BIO_KEY = 'voip_bio'

export interface AccountPrefs {
  name: string
  email: string
  password: string
  avatar: string
  status: string
  bio: string
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

function loadStatus(): string {
  try { return localStorage.getItem(STATUS_KEY) ?? '' } catch { return '' }
}

function loadBio(): string {
  try { return localStorage.getItem(BIO_KEY) ?? '' } catch { return '' }
}

function persistAvatar(avatar: string): void {
  try {
    if (avatar) localStorage.setItem(AVATAR_KEY, avatar)
    else localStorage.removeItem(AVATAR_KEY)
  } catch { /* ignore */ }
}

function persistStatus(status: string): void {
  try {
    if (status) localStorage.setItem(STATUS_KEY, status)
    else localStorage.removeItem(STATUS_KEY)
  } catch { /* ignore */ }
}

function persistBio(bio: string): void {
  try {
    if (bio) localStorage.setItem(BIO_KEY, bio)
    else localStorage.removeItem(BIO_KEY)
  } catch { /* ignore */ }
}

export function clearAccountPrefs(): void {
  try {
    localStorage.removeItem(AVATAR_KEY)
    localStorage.removeItem(STATUS_KEY)
    localStorage.removeItem(BIO_KEY)
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
  status: string
  bio: string
  prefsOpen: boolean
  chatFullscreen: boolean
  dmFullscreen: boolean
  adminOpen: boolean
  setPrefs: (prefs: Partial<AccountPrefs>) => void
  savePrefs: (prefs: AccountPrefs) => void
  openPrefs: () => void
  closePrefs: () => void
  toggleFullscreen: () => void
  toggleDmFullscreen: () => void
  openAdmin: () => void
  closeAdmin: () => void
}

const initial = loadCredentials()

export const useAccountStore = create<AccountStore>((set) => ({
  name: initial.name,
  email: initial.email,
  password: initial.password,
  avatar: loadAvatar(),
  status: loadStatus(),
  bio: loadBio(),
  prefsOpen: false,
  chatFullscreen: false,
  dmFullscreen: false,
  adminOpen: false,
  setPrefs: (prefs) =>
    set((s) => ({
      name: prefs.name ?? s.name,
      email: prefs.email ?? s.email,
      password: prefs.password ?? s.password,
      avatar: prefs.avatar ?? s.avatar,
      status: prefs.status ?? s.status,
      bio: prefs.bio ?? s.bio,
    })),
  savePrefs: (prefs) => {
    persistAvatar(prefs.avatar)
    persistStatus(prefs.status)
    persistBio(prefs.bio)
    persistCredentials(prefs.name, prefs.email, prefs.password)
    set({ name: prefs.name, email: prefs.email, password: prefs.password, avatar: prefs.avatar, status: prefs.status, bio: prefs.bio })
  },
  openPrefs: () => set({ prefsOpen: true }),
  closePrefs: () => set({ prefsOpen: false }),
  toggleFullscreen: () => set((s) => ({ chatFullscreen: !s.chatFullscreen })),
  toggleDmFullscreen: () => set((s) => ({ dmFullscreen: !s.dmFullscreen })),
  openAdmin: () => set({ adminOpen: true }),
  closeAdmin: () => set({ adminOpen: false }),
}))
