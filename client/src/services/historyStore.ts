import type { ChatMsg, PrivateChatMsg } from '../types/index.ts'

const DB_NAME = 'voip_history'
const DB_VERSION = 1
const ROOM_STORE = 'room_messages'
const DM_STORE = 'dm_messages'
const LS_PREFIX = 'voip.history.'

interface Db {
  db: IDBDatabase | null
  unsupported: boolean
}

let state: Db = { db: null, unsupported: false }
let openPromise: Promise<IDBDatabase | null> | null = null

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase | null> {
  if (openPromise) return openPromise
  if (!hasIndexedDb()) {
    state.unsupported = true
    openPromise = Promise.resolve(null)
    return openPromise
  }
  openPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(ROOM_STORE)) {
          db.createObjectStore(ROOM_STORE, { keyPath: 'roomId' })
        }
        if (!db.objectStoreNames.contains(DM_STORE)) {
          db.createObjectStore(DM_STORE, { keyPath: 'key' })
        }
      }
      req.onsuccess = () => {
        state.db = req.result
        resolve(req.result)
      }
      req.onerror = () => {
        state.unsupported = true
        resolve(null)
      }
    } catch {
      state.unsupported = true
      resolve(null)
    }
  })
  return openPromise
}

function localStorageGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function localStorageSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
  } catch { /* cota cheia: ignora */ }
}

async function saveRecord<T>(store: string, key: string, msgs: T[]): Promise<void> {
  const db = await openDb()
  if (!db) {
    localStorageSet(store + ':' + key, msgs)
    return
  }
  try {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put({ key, msgs } as unknown as Record<string, unknown>)
    tx.onerror = () => { /* ignore */ }
  } catch { /* ignore */ }
}

async function loadRecord<T>(store: string, key: string): Promise<T[] | null> {
  const db = await openDb()
  if (!db) {
    const cached = localStorageGet<{ msgs: T[] } | T[]>(store + ':' + key)
    if (Array.isArray(cached)) return cached
    return null
  }
  try {
    return await new Promise<T[] | null>((resolve) => {
      const tx = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).get(key)
      req.onsuccess = () => {
        const row = req.result as { msgs?: T[] } | undefined
        resolve(row?.msgs ?? null)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function deleteRecord(store: string, key: string): Promise<void> {
  const db = await openDb()
  if (!db) {
    try {
      localStorage.removeItem(LS_PREFIX + store + ':' + key)
    } catch { /* ignore */ }
    return
  }
  try {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.onerror = () => { /* ignore */ }
  } catch { /* ignore */ }
}

export const chatHistory = {
  async saveRoomMessages(roomId: string, msgs: ChatMsg[]): Promise<void> {
    await saveRecord<ChatMsg>(ROOM_STORE, roomId, msgs)
  },
  async loadRoomMessages(roomId: string): Promise<ChatMsg[] | null> {
    return loadRecord<ChatMsg>(ROOM_STORE, roomId)
  },
  async clearRoomMessages(roomId: string): Promise<void> {
    await deleteRecord(ROOM_STORE, roomId)
  },
  async saveDmMessages(key: string, msgs: PrivateChatMsg[]): Promise<void> {
    await saveRecord<PrivateChatMsg>(DM_STORE, key, msgs)
  },
  async loadDmMessages(key: string): Promise<PrivateChatMsg[] | null> {
    return loadRecord<PrivateChatMsg>(DM_STORE, key)
  },
}
