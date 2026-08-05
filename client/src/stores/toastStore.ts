import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  duration?: number
}

interface ToastStore {
  toasts: Toast[]
  show: (kind: ToastKind, message: string) => void
  dismiss: (id: number) => void
}

let nextId = 1
const TOAST_DURATION = 3000

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  show: (kind, message) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, TOAST_DURATION)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
