import { Room, Client, LiveState, ChatMessage } from '../types/index.js'
import { logger } from '../utils/logger.js'
import { eventBus } from '../utils/events.js'
import { EventType } from '../types/index.js'
import { SqliteStore } from '../storage/index.js'

const DEFAULT_ROOM_NAMES = ['Externas', 'Trânsito', 'Ao vivo', 'Jornada Esportiva', 'Retorno ao vivo', 'Boletins gravados']

export class RoomManager {
  private rooms = new Map<string, Room>()
  private maxRooms: number
  private liveBroadcasts = new Map<string, LiveState>()
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
    eventBus.emit(EventType.RoomCreated, { roomId: id, roomName: name })
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
    eventBus.emit(EventType.RoomDeleted, { roomId, roomName: room.name })
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
    eventBus.emit(EventType.RoomJoined, { clientId: client.id, roomId })
    return true
  }

  leave(roomId: string, client: Client): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false

    room.clients.delete(client.id)
    client.room = null
    logger.info('RoomManager', `${client.name} left ${room.name}`)
    eventBus.emit(EventType.RoomLeft, { clientId: client.id, roomId })

    return true
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  getAll(): Room[] {
    return Array.from(this.rooms.values()).sort((a, b) => {
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

  findByName(name: string): Room | null {
    return this.getAll().find((r) => r.name === name) ?? null
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
  } {
    const live = this.liveBroadcasts.get(room.id)
    return {
      id: room.id,
      name: room.name,
      users: room.clients.size,
      fixed: room.fixed,
      featured: room.featured,
      createdBy: room.createdBy,
      createdByName: room.createdByName,
      live: live ? { userId: live.userId, userName: live.userName } : null,
    }
  }

  getLiveBroadcast(roomId: string): LiveState | undefined {
    return this.liveBroadcasts.get(roomId)
  }

  setLiveBroadcast(roomId: string, state: LiveState): void {
    this.liveBroadcasts.set(roomId, state)
  }

  clearLiveBroadcast(roomId: string): void {
    this.liveBroadcasts.delete(roomId)
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
    createdByName?: string
  }> {
    // Ordem estável (inserção) para o painel do admin: fixar/destacar não
    // deve "mover" as salas na lista.
    return Array.from(this.rooms.values()).map((room) => ({
      id: room.id,
      name: room.name,
      fixed: room.fixed,
      featured: room.featured,
      users: room.clients.size,
      messages: room.messages.length,
      occupants: Array.from(room.clients.values()).map((c) => c.name),
      live: this.getLiveBroadcast(room.id) ? { userId: this.getLiveBroadcast(room.id)!.userId, userName: this.getLiveBroadcast(room.id)!.userName } : null,
      createdByName: room.createdByName,
    }))
  }
}
