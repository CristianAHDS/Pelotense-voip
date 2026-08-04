import { create } from 'zustand'

interface LiveBroadcast {
  userId: string
  userName: string
  timestamp?: number
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
  // Em salas comuns há um único broadcaster; em multilive podem existir vários.
  broadcasters: LiveBroadcast[]
  chunks: LiveChunk[]
  mime: string | null
  myMime: string | null
  pendingRequest: PendingRequest | null
  takeoverRequestSent: boolean
  requestDenied: number
  addBroadcaster: (b: LiveBroadcast) => void
  removeBroadcaster: (userId: string) => void
  clearBroadcasters: () => void
  setMime: (mime: string | null) => void
  setMyMime: (mime: string | null) => void
  addChunk: (chunk: LiveChunk) => void
  clearChunks: () => void
  setPendingRequest: (r: PendingRequest | null) => void
  setTakeoverRequestSent: (v: boolean) => void
  setRequestDenied: () => void
}

function upsert(list: LiveBroadcast[], b: LiveBroadcast): LiveBroadcast[] {
  return list.some((x) => x.userId === b.userId)
    ? list.map((x) => (x.userId === b.userId ? b : x))
    : [...list, b]
}

export const useLiveStore = create<LiveState>((set) => ({
  broadcasters: [],
  chunks: [],
  mime: null,
  myMime: null,
  pendingRequest: null,
  takeoverRequestSent: false,
  requestDenied: 0,
  addBroadcaster: (b) => set((s) => ({ broadcasters: upsert(s.broadcasters, b) })),
  removeBroadcaster: (userId) => set((s) => ({ broadcasters: s.broadcasters.filter((x) => x.userId !== userId) })),
  clearBroadcasters: () => set({ broadcasters: [], mime: null }),
  setMime: (mime) => set({ mime }),
  setMyMime: (myMime) => set({ myMime }),
  addChunk: (chunk) => set((s) => ({ chunks: [...s.chunks.slice(-199), chunk] })),
  clearChunks: () => set({ chunks: [] }),
  setPendingRequest: (r) => set({ pendingRequest: r }),
  setTakeoverRequestSent: (v) => set({ takeoverRequestSent: v }),
  setRequestDenied: () => set((s) => ({ requestDenied: s.requestDenied + 1 })),
}))
