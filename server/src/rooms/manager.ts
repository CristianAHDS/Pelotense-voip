import { Room, Client } from '../types/index.js'
import { logger } from '../utils/logger.js'
import { eventBus } from '../utils/events.js'
import { EventType } from '../types/index.js'

export class RoomManager {
  private rooms = new Map<string, Room>()
  private maxRooms: number

  constructor(maxRooms: number) {
    this.maxRooms = maxRooms
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
    }

    this.rooms.set(id, room)
    logger.info('RoomManager', `Room created: ${name}`, { id })
    eventBus.emit(EventType.RoomCreated, { roomId: id, roomName: name })
    return room
  }

  delete(roomId: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false

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
    return Array.from(this.rooms.values())
  }

  getClients(roomId: string): Client[] {
    const room = this.rooms.get(roomId)
    return room ? Array.from(room.clients.values()) : []
  }

  findByName(name: string): Room | null {
    return this.getAll().find((r) => r.name === name) ?? null
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 10)
  }
}
