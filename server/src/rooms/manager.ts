import { Room, Client } from '../types/index.js'
import { logger } from '../utils/logger.js'
import { eventBus } from '../utils/events.js'
import { EventType } from '../types/index.js'

const DEFAULT_ROOM_NAMES = ['Externas', 'Trânsito', 'Jornada Esportiva']

export class RoomManager {
  private rooms = new Map<string, Room>()
  private maxRooms: number

  constructor(maxRooms: number) {
    this.maxRooms = maxRooms
    this.initDefaultRooms()
  }

  private initDefaultRooms(): void {
    for (const name of DEFAULT_ROOM_NAMES) {
      const id = this.fixedId(name)
      const room: Room = {
        id,
        name,
        clients: new Map(),
        createdAt: Date.now(),
        messages: [],
        fixed: true,
      }
      this.rooms.set(id, room)
      logger.info('RoomManager', `Default room created: ${name}`, { id })
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

  create(name: string): Room | null {
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
    }

    this.rooms.set(id, room)
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

    this.rooms.delete(roomId)
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

  toRoomListPayload(room: Room): { id: string; name: string; users: number; fixed: boolean } {
    return {
      id: room.id,
      name: room.name,
      users: room.clients.size,
      fixed: room.fixed,
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 10)
  }
}
