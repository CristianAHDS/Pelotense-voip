import { WebSocketServer, WebSocket } from 'ws'
import { Client, WsMessage, WsMessageType } from '../types/index.js'
import { ClientManager } from '../clients/index.js'
import { RoomManager } from '../rooms/index.js'
import { logger } from '../utils/logger.js'
import { eventBus } from '../utils/events.js'
import { EventType } from '../types/index.js'

export class WsHandler {
  private wss: WebSocketServer
  private clients: ClientManager
  private rooms: RoomManager
  private udpPort: number
  private pendingClients = new Map<WebSocket, { ip: string }>()

  constructor(
    wss: WebSocketServer,
    clients: ClientManager,
    rooms: RoomManager,
    udpPort: number,
  ) {
    this.wss = wss
    this.clients = clients
    this.rooms = rooms
    this.udpPort = udpPort
    this.setup()
  }

  private setup(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const ip = req.socket.remoteAddress ?? 'unknown'
      this.pendingClients.set(ws, { ip })

      const onMessage = (data: Buffer) => {
        try {
          const msg: WsMessage = JSON.parse(data.toString())
          if (msg.type === WsMessageType.Login) {
            this.handleLogin(ws, msg.payload as { name: string; password: string })
          } else {
            this.send(ws, { type: WsMessageType.Error, payload: 'Login first' })
            ws.close()
          }
        } catch {
          logger.warn('WsHandler', 'Invalid message during login')
          ws.close()
        }
      }

      const timeout = setTimeout(() => {
        if (this.pendingClients.has(ws)) {
          this.send(ws, { type: WsMessageType.Error, payload: 'Login timeout' })
          ws.close()
          cleanup()
        }
      }, 10000)

      const cleanup = () => {
        clearTimeout(timeout)
        ws.off('message', onMessage)
        this.pendingClients.delete(ws)
      }

      ws.on('message', onMessage)
      ws.on('close', () => cleanup())
      ws.on('error', () => cleanup())
    })
  }

  private handleLogin(ws: WebSocket, payload: { name: string; password: string }): void {
    const pending = this.pendingClients.get(ws)
    if (!pending) return

    const { name, password } = payload
    if (!name || !password) {
      this.send(ws, { type: WsMessageType.Error, payload: 'Name and password required' })
      ws.close()
      return
    }

    const existing = this.clients.findByName(name)
    if (existing) {
      if (existing.password !== password) {
        this.send(ws, { type: WsMessageType.Error, payload: 'Wrong password' })
        ws.close()
        return
      }
      this.removeExistingClient(existing)
    }

    const id = this.generateId()
    const client: Client = {
      id,
      name,
      password,
      room: null,
      udpPort: 0,
      ip: pending.ip,
      lastPing: Date.now(),
      ws,
    }

    if (!this.clients.add(client)) {
      this.send(ws, { type: WsMessageType.Error, payload: 'Server full' })
      ws.close()
      return
    }

    this.pendingClients.delete(ws)
    ws.removeAllListeners('message')

    ws.on('message', (data) => {
      try {
        const msg: WsMessage = JSON.parse(data.toString())
        this.handleMessage(client, msg)
      } catch {
        logger.warn('WsHandler', `Invalid message from ${client.id}`)
      }
    })

    ws.on('close', () => this.handleDisconnect(client))
    ws.on('error', () => this.handleDisconnect(client))

    this.send(ws, {
      type: WsMessageType.Welcome,
      payload: { id: client.id, name: client.name, udpPort: this.udpPort },
    })

    this.broadcast({
      type: WsMessageType.UserList,
      payload: this.clients.getAll().map((c) => ({
        id: c.id, name: c.name, room: c.room,
      })),
    })
    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => ({
        id: r.id, name: r.name, users: r.clients.size,
      })),
    })

    eventBus.emit(EventType.ClientConnected, {
      clientId: client.id,
      name: client.name,
    })
  }

  private removeExistingClient(client: Client): void {
    const roomId = client.room
    if (roomId) {
      this.broadcastToRoom(roomId, {
        type: WsMessageType.UserLeft,
        payload: { id: client.id, name: client.name },
      }, client.id)
      this.rooms.leave(roomId, client)
    }
    try { client.ws.close() } catch { /* ignore */ }
    this.clients.remove(client.id)
    this.broadcast({
      type: WsMessageType.UserList,
      payload: this.clients.getAll().map((c) => ({
        id: c.id, name: c.name, room: c.room,
      })),
    })
    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => ({
        id: r.id, name: r.name, users: r.clients.size,
      })),
    })
    eventBus.emit(EventType.ClientDisconnected, {
      clientId: client.id,
      name: client.name,
    })
    logger.info('WsHandler', `Existing client ${client.name} replaced by new login`)
  }

  private handleMessage(client: Client, msg: WsMessage): void {
    switch (msg.type) {
      case WsMessageType.Heartbeat:
        this.clients.updatePing(client.id)
        this.send(client.ws, { type: WsMessageType.Heartbeat })
        break

      case WsMessageType.JoinRoom:
        this.handleJoinRoom(client, msg.payload as string)
        break

      case WsMessageType.LeaveRoom:
        this.handleLeaveRoom(client)
        break

      case WsMessageType.CreateRoom:
        this.handleCreateRoom(client, msg.payload as string)
        break

      case WsMessageType.DeleteRoom:
        this.handleDeleteRoom(client, msg.payload as string)
        break

      case WsMessageType.ListRooms:
        this.send(client.ws, {
          type: WsMessageType.RoomList,
          payload: this.rooms.getAll().map((r) => ({
            id: r.id,
            name: r.name,
            users: r.clients.size,
          })),
        })
        break

      case WsMessageType.ListUsers:
        this.send(client.ws, {
          type: WsMessageType.UserList,
          payload: this.clients.getAll().map((c) => ({
            id: c.id,
            name: c.name,
            room: c.room,
          })),
        })
        break

      default:
        logger.warn('WsHandler', `Unknown message type: ${msg.type}`)
    }
  }

  private handleJoinRoom(client: Client, roomName: string): void {
    if (!roomName) {
      this.send(client.ws, {
        type: WsMessageType.Error,
        payload: 'Room name required',
      })
      return
    }

    let room = this.rooms.findByName(roomName)
    if (!room) {
      room = this.rooms.create(roomName)
      if (!room) {
        this.send(client.ws, {
          type: WsMessageType.Error,
          payload: 'Cannot create room',
        })
        return
      }
    }

    this.rooms.join(room.id, client)
    this.send(client.ws, {
      type: WsMessageType.RoomJoined,
      payload: { roomId: room.id, roomName: room.name },
    })

    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => ({
        id: r.id, name: r.name, users: r.clients.size,
      })),
    })
    this.broadcast({
      type: WsMessageType.UserList,
      payload: this.clients.getAll().map((c) => ({
        id: c.id, name: c.name, room: c.room,
      })),
    })
  }

  private handleLeaveRoom(client: Client): void {
    if (!client.room) return
    const roomId = client.room
    const userName = client.name
    this.send(client.ws, {
      type: WsMessageType.RoomLeft,
      payload: { roomId },
    })
    this.rooms.leave(roomId, client)
    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => ({
        id: r.id, name: r.name, users: r.clients.size,
      })),
    })
    this.broadcast({
      type: WsMessageType.UserList,
      payload: this.clients.getAll().map((c) => ({
        id: c.id, name: c.name, room: c.room,
      })),
    })
  }

  private handleCreateRoom(client: Client, roomName: string): void {
    if (!roomName) {
      this.send(client.ws, {
        type: WsMessageType.Error,
        payload: 'Room name required',
      })
      return
    }
    const room = this.rooms.create(roomName)
    if (!room) {
      this.send(client.ws, {
        type: WsMessageType.Error,
        payload: 'Cannot create room',
      })
      return
    }
    this.send(client.ws, {
      type: WsMessageType.RoomCreated,
      payload: { roomId: room.id, roomName: room.name },
    })
    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => ({
        id: r.id, name: r.name, users: r.clients.size,
      })),
    })
  }

  private handleDeleteRoom(client: Client, roomId: string): void {
    if (!roomId) {
      this.send(client.ws, {
        type: WsMessageType.Error,
        payload: 'Room ID required',
      })
      return
    }
    this.rooms.delete(roomId)
    this.send(client.ws, {
      type: WsMessageType.RoomDeleted,
      payload: { roomId },
    })
    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => ({
        id: r.id, name: r.name, users: r.clients.size,
      })),
    })
  }

  private handleDisconnect(client: Client): void {
    const roomId = client.room
    const userName = client.name

    if (roomId) {
      this.rooms.leave(roomId, client)
    }
    this.clients.remove(client.id)
    this.broadcast({
      type: WsMessageType.UserList,
      payload: this.clients.getAll().map((c) => ({
        id: c.id, name: c.name, room: c.room,
      })),
    })
    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => ({
        id: r.id, name: r.name, users: r.clients.size,
      })),
    })
    eventBus.emit(EventType.ClientDisconnected, {
      clientId: client.id,
      name: userName,
    })
  }

  private send(ws: WebSocket, msg: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  private broadcast(msg: WsMessage): void {
    const data = JSON.stringify(msg)
    this.clients.getAll().forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(data)
      }
    })
  }

  private broadcastToRoom(roomId: string, msg: WsMessage, excludeId: string): void {
    const clients = this.rooms.getClients(roomId)
    clients.forEach((c) => {
      if (c.id !== excludeId) {
        this.send(c.ws, msg)
      }
    })
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 10)
  }
}
