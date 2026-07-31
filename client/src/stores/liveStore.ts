import { create } from 'zustand'

interface LiveBroadcast {
  userId: string
  userName: string
}

interface LiveChunk {
  userId: string
  chunk: string
  duration: number
}

interface PendingRequest {
  fromUserId: string
  fromUserName: string
}

interface LiveState {
  broadcaster: LiveBroadcast | null
  chunks: LiveChunk[]
  pendingRequest: PendingRequest | null
  takeoverRequestSent: boolean
  requestDenied: number
  setBroadcaster: (b: LiveBroadcast | null) => void
  addChunk: (chunk: LiveChunk) => void
  clearChunks: () => void
  setPendingRequest: (r: PendingRequest | null) => void
  setTakeoverRequestSent: (v: boolean) => void
  setRequestDenied: () => void
}

export const useLiveStore = create<LiveState>((set) => ({
  broadcaster: null,
  chunks: [],
  pendingRequest: null,
  takeoverRequestSent: false,
  requestDenied: 0,
  setBroadcaster: (b) => set({ broadcaster: b, chunks: b ? [] : [] }),
  addChunk: (chunk) => set((s) => ({ chunks: [...s.chunks.slice(-199), chunk] })),
  clearChunks: () => set({ chunks: [] }),
  setPendingRequest: (r) => set({ pendingRequest: r }),
  setTakeoverRequestSent: (v) => set({ takeoverRequestSent: v }),
  setRequestDenied: () => set((s) => ({ requestDenied: s.requestDenied + 1 })),
}))
