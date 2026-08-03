import { Room, Client, LiveState, ChatMessage } from '../types/index.js'
import { logger } from '../utils/logger.js'
import { SqliteStore } from '../storage/index.js'

const DEFAULT_ROOM_NAMES = ['Externas', 'Trânsito', 'Ao vivo', 'Jornada Esportiva', 'Retorno ao vivo', 'Boletins gravados', 'Multilives']

// Sala fixa onde várias pessoas transmitem ao vivo simultaneamente (mosaico).
export const MULTILIVE_ROOM_NAME = 'Multilives'

export class RoomManager {
  private rooms = new Map<string, Room>()
  private maxRooms: number
  // Várias lives por sala (multilive): roomId -> (userId -> LiveState). Em salas
  // comuns só há uma live ativa por vez (fluxo de takeover continua valendo).
  private liveBroadcasts = new Map<string, Map<string, LiveState>>()
  private storage?: SqliteStore

  constructor(maxRooms: number, storage?: SqliteStore) {
    this.maxRooms = maxRooms
    this.storage = storage
    this.initDefaultRooms()
    this.loadPersistedRooms()
  }

  private initDefaultRooms(): void {
    const featured: Record<string, number> = {
      'Retorno ao vivo': 1,
      'Boletins gravados': 2,
      'Ao vivo': 3,
      // Multilives assume o destaque/posição da sala "Ao vivo" (desativada).
      'Multilives': 3,
    }
    for (const name of DEFAULT_ROOM_NAMES) {
      const id = this.fixedId(name)
      const room: Room = {
        id,
        name,
        clients: new Map(),
        createdAt: Date.now(),
        messages: [],
        fixed: true,
        disabled: name === 'Ao vivo',
        featured: featured[name],
      }
      this.rooms.set(id, room)
      logger.info('RoomManager', `Default room created: ${name}`, { id })
    }
  }

  private loadPersistedRooms(): void {
    if (!this.storage) return
    for (const stored of this.storage.loadRooms()) {
      if (stored.fixed) continue
      const room: Room = {
        id: stored.id,
        name: stored.name,
        clients: new Map(),
        createdAt: stored.createdAt,
        messages: this.storage.loadMessages(stored.id),
        fixed: false,
        createdBy: stored.createdBy,
        createdByName: stored.createdByName,
      }
      this.rooms.set(room.id, room)
      logger.info('RoomManager', `Persisted room restored: ${room.name}`, { id: room.id })
    }
    // Carrega mensagens das salas fixas também (histórico sobrevive ao restart).
    for (const room of this.rooms.values()) {
      if (room.fixed) {
        room.messages = this.storage.loadMessages(room.id)
      }
    }
  }

  private fixedId(name: string): string {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash) + name.charCodeAt(i)
      hash |= 0
    }
    return 'fixed_' + Math.abs(hash).toString(36)
  }

  create(name: string, createdBy?: string, createdByName?: string): Room | null {
    if (this.isNameDisabled(name)) {
      logger.warn('RoomManager', `Room name is disabled: ${name}`)
      return null
    }
    if (this.rooms.size >= this.maxRooms) {
      logger.warn('RoomManager', 'Max rooms reached')
      return null
    }

    const id = this.generateId()
    const room: Room = {
      id,
      name,
      clients: new Map(),
      createdAt: Date.now(),
      messages: [],
      fixed: false,
      createdBy,
      createdByName,
    }

    this.rooms.set(id, room)
    this.storage?.saveRoom(room)
    logger.info('RoomManager', `Room created: ${name}`, { id })
    return room
  }

  delete(roomId: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false
    if (room.fixed) return false

    room.clients.forEach((client) => {
      client.room = null
    })

    this.liveBroadcasts.delete(roomId)
    this.rooms.delete(roomId)
    this.storage?.deleteRoom(roomId)
    logger.info('RoomManager', `Room deleted: ${room.name}`, { id: roomId })
    return true
  }

  join(roomId: string, client: Client): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false

    if (client.room) {
      this.leave(client.room, client)
    }

    room.clients.set(client.id, client)
    client.room = roomId
    logger.info('RoomManager', `${client.name} joined ${room.name}`)
    return true
  }

  leave(roomId: string, client: Client): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false

    room.clients.delete(client.id)
    client.room = null
    logger.info('RoomManager', `${client.name} left ${room.name}`)

    return true
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  getAll(): Room[] {
    return Array.from(this.rooms.values())
      .filter((r) => !r.disabled)
      .sort((a, b) => {
        const af = a.featured ?? Infinity
        const bf = b.featured ?? Infinity
        if (af !== bf) return af - bf
        if (a.fixed !== b.fixed) return a.fixed ? -1 : 1
        return a.createdAt - b.createdAt
      })
  }

  getClients(roomId: string): Client[] {
    const room = this.rooms.get(roomId)
    return room ? Array.from(room.clients.values()) : []
  }

  // Encontra por nome mesmo salas desativadas (reconexão de quem já estava,
  // encaminhamento, etc.). A desativação esconde a sala das LISTAS (getAll/
  // listRoomsDetailed), não remove do mapa.
  findByName(name: string): Room | null {
    for (const room of this.rooms.values()) {
      if (room.name === name) return room
    }
    return null
  }

  isNameDisabled(name: string): boolean {
    for (const room of this.rooms.values()) {
      if (room.name === name && room.disabled) return true
    }
    return false
  }

  toRoomListPayload(room: Room): {
    id: string
    name: string
    users: number
    fixed: boolean
    featured?: number
    createdBy?: string
    createdByName?: string
    live?: { userId: string; userName: string } | null
    lives: Array<{ userId: string; userName: string }>
  } {
    const lives = this.getLiveBroadcasts(room.id).map((l) => ({ userId: l.userId, userName: l.userName }))
    return {
      id: room.id,
      name: room.name,
      users: room.clients.size,
      fixed: room.fixed,
      featured: room.featured,
      createdBy: room.createdBy,
      createdByName: room.createdByName,
      live: lives[0] ?? null,
      lives,
    }
  }

  getLiveBroadcast(roomId: string): LiveState | undefined {
    const map = this.liveBroadcasts.get(roomId)
    return map ? Array.from(map.values())[0] : undefined
  }

  getLiveBroadcasts(roomId: string): LiveState[] {
    const map = this.liveBroadcasts.get(roomId)
    return map ? Array.from(map.values()) : []
  }

  getLiveCount(roomId: string): number {
    return this.liveBroadcasts.get(roomId)?.size ?? 0
  }

  setLiveBroadcast(roomId: string, state: LiveState): void {
    let map = this.liveBroadcasts.get(roomId)
    if (!map) {
      map = new Map()
      this.liveBroadcasts.set(roomId, map)
    }
    map.set(state.userId, state)
  }

  clearLiveBroadcast(roomId: string, userId?: string): void {
    if (!userId) {
      this.liveBroadcasts.delete(roomId)
      return
    }
    const map = this.liveBroadcasts.get(roomId)
    if (!map) return
    map.delete(userId)
    if (map.size === 0) {
      this.liveBroadcasts.delete(roomId)
    }
  }

  isMultiLiveRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId)
    return room?.name === MULTILIVE_ROOM_NAME
  }

  addMessage(roomId: string, msg: ChatMessage): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    room.messages.push(msg)
    this.storage?.saveMessage(roomId, msg)
  }

  updateMessage(roomId: string, msg: ChatMessage): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    const idx = room.messages.findIndex((m) => m.id === msg.id)
    if (idx === -1) return
    room.messages[idx] = msg
    this.storage?.saveMessage(roomId, msg)
  }

  deleteMessage(roomId: string, messageId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    const idx = room.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return
    room.messages.splice(idx, 1)
    this.storage?.deleteMessage(roomId, messageId)
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 10)
  }

  setMaxRooms(n: number): void {
    this.maxRooms = Math.max(1, Math.floor(n))
  }

  getMaxRooms(): number {
    return this.maxRooms
  }

  setStorage(storage?: SqliteStore): void {
    this.storage = storage
  }

  // ---- Gestão de salas pelo admin (A9) ----
  rename(roomId: string, newName: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false
    if (this.findByName(newName) && this.findByName(newName)!.id !== roomId) return false
    room.name = newName
    this.storage?.saveRoom(room)
    return true
  }

  setFixed(roomId: string, fixed: boolean): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false
    room.fixed = fixed
    this.storage?.saveRoom(room)
    return true
  }

  setFeatured(roomId: string, featured: number | undefined): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false
    room.featured = featured
    this.storage?.saveRoom(room)
    return true
  }

  clearMessages(roomId: string): number {
    const room = this.rooms.get(roomId)
    if (!room) return 0
    const count = room.messages.length
    room.messages = []
    this.storage?.clearRoomMessages(roomId)
    return count
  }

  listRoomsDetailed(): Array<{
    id: string
    name: string
    fixed: boolean
    featured?: number
    users: number
    messages: number
    occupants: string[]
    live?: { userId: string; userName: string } | null
    lives: Array<{ userId: string; userName: string }>
    createdByName?: string
  }> {
    // Ordem estável (inserção) para o painel do admin: fixar/destacar não
    // deve "mover" as salas na lista. Salas desativadas não aparecem.
    return Array.from(this.rooms.values())
      .filter((room) => !room.disabled)
      .map((room) => {
      const lives = this.getLiveBroadcasts(room.id).map((l) => ({ userId: l.userId, userName: l.userName }))
      return {
        id: room.id,
        name: room.name,
        fixed: room.fixed,
        featured: room.featured,
        users: room.clients.size,
        messages: room.messages.length,
        occupants: Array.from(room.clients.values()).map((c) => c.name),
        live: lives[0] ?? null,
        lives,
        createdByName: room.createdByName,
      }
    })
  }
}
