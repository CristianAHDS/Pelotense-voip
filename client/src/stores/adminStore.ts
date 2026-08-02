import { create } from 'zustand'
import { AdminMetrics, AdminRoomInfo, AdminBan, AdminLogEntry, AdminDiagnostics } from '../types/index.ts'
import { sendAdminCmd } from '../services/connectionService.ts'
import { useToastStore } from './toastStore.ts'

interface AdminStore {
  metrics: AdminMetrics | null
  diagnostics: AdminDiagnostics | null
  rooms: AdminRoomInfo[] | null
  bans: AdminBan[] | null
  log: AdminLogEntry[] | null
  limits: Record<string, number> | null
  backup: { base64: string; size: number; date: number } | null
  cleanup: { messages: number; privateMessages: number; accounts: number; emptyRooms: string[] } | null
  pending: Record<string, boolean>
  lastError: string | null
  run: (cmd: string, payload?: Record<string, unknown>) => void
  refreshAll: () => void
  clear: () => void
  handleResult: (cmd: string, ok: boolean, data?: unknown, error?: string) => void
}

export const useAdminStore = create<AdminStore>((set, get) => ({
  metrics: null,
  diagnostics: null,
  rooms: null,
  bans: null,
  log: null,
  limits: null,
  backup: null,
  cleanup: null,
  pending: {},
  lastError: null,
  run: (cmd, payload = {}) => {
    set((s) => ({ pending: { ...s.pending, [cmd]: true }, lastError: null }))
    sendAdminCmd(cmd, payload)
  },
  refreshAll: () => {
    get().run('metrics')
    get().run('rooms')
    get().run('banned')
    get().run('log')
    get().run('limits')
  },
  clear: () =>
    set({
      metrics: null,
      diagnostics: null,
      rooms: null,
      bans: null,
      log: null,
      limits: null,
      backup: null,
      cleanup: null,
      pending: {},
      lastError: null,
    }),
  handleResult: (cmd, ok, data, error) => {
    const pending = { ...get().pending }
    delete pending[cmd]
    const base: Partial<AdminStore> = { pending, lastError: ok ? null : (error ?? null) }
    if (!ok) {
      if (error) useToastStore.getState().show('error', `Admin: ${error}`)
      set({ ...base, pending })
      return
    }
    switch (cmd) {
      case 'metrics':
        set({ ...base, metrics: data as AdminMetrics })
        break
      case 'diagnostics':
        set({ ...base, diagnostics: data as AdminDiagnostics })
        break
      case 'rooms':
        set({ ...base, rooms: data as AdminRoomInfo[] })
        break
      case 'banned':
      case 'ban':
      case 'unban':
        set({ ...base, bans: data as AdminBan[] })
        break
      case 'log':
        set({ ...base, log: data as AdminLogEntry[] })
        break
      case 'limits':
        set({ ...base, limits: data as Record<string, number> })
        break
      case 'limit':
        set({ ...base, limits: data as Record<string, number> })
        break
      case 'backup':
        set({ ...base, backup: data as { base64: string; size: number; date: number } })
        break
      case 'restore':
      case 'announce':
      case 'kick':
      case 'restrictions':
      case 'onboarding_reset':
      case 'video_settings':
        useToastStore.getState().show('success', `Admin: ${cmd} OK`)
        set({ ...base })
        break
      case 'cleanup':
        set({ ...base, cleanup: data as { messages: number; privateMessages: number; accounts: number; emptyRooms: string[] } })
        break
      case 'cleanup_apply': {
        const d = data as { roomMessages: number; privateMessages: number; roomsRemoved: number }
        useToastStore.getState().show('success', `Limpeza: ${d.roomMessages} msgs de sala, ${d.privateMessages} privadas, ${d.roomsRemoved} salas`)
        set({ ...base, cleanup: null })
        get().run('metrics')
        get().run('rooms')
        break
      }
      case 'room_action':
        set({ ...base, rooms: data as AdminRoomInfo[] })
        break
      case 'maintenance':
        get().run('metrics')
        get().run('diagnostics')
        set({ ...base })
        break
      default:
        set({ ...base })
    }
  },
}))
