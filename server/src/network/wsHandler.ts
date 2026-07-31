import { WebSocketServer, WebSocket } from 'ws'
import { Client, ChatMessage, WsMessage, WsMessageType, LiveState } from '../types/index.js'
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

      ws.on('message', (data, isBinary) => {
        try {
          if (isBinary) {
            this.handleBinaryMessage(client, data as Buffer)
            return
          }
          const msg: WsMessage = JSON.parse((data as Buffer).toString())
          this.handleMessage(client, msg)
        } catch (e) {
          logger.warn('WsHandler', `Invalid message from ${client.id}: ${(e as Error).message}`)
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
      payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
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
      payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
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
          payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
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

      case WsMessageType.ChatMessage:
        this.handleChatMessage(client, msg.payload as { text: string })
        break

      case WsMessageType.ChatAudioMessage:
        this.handleChatAudioMessage(client, msg.payload as { audioData: string; duration: number })
        break

      case WsMessageType.ChatVideoMessage:
        this.handleChatVideoMessage(client, msg.payload as { videoData: string; duration: number })
        break

      case WsMessageType.DeleteMessage:
        this.handleDeleteMessage(client, msg.payload as { messageId: string })
        break

      case WsMessageType.PrivateMessage:
        this.handlePrivateMessage(client, msg.payload as { toUserId: string; text: string })
        break

      case WsMessageType.LiveStart:
        this.handleLiveStart(client)
        break

      case WsMessageType.LiveStop:
        this.handleLiveStop(client)
        break

      case WsMessageType.LiveChunk:
        this.handleLiveChunk(client, msg.payload as { chunk: string; duration: number })
        break

      case WsMessageType.LiveRequestResponse:
        this.handleLiveRequestResponse(client, msg.payload as { allow: boolean; requesterId: string })
        break

      case WsMessageType.LiveRequestCancel:
        this.handleLiveRequestCancel(client)
        break

      default:
        logger.warn('WsHandler', `Unknown message type: ${msg.type}`)
    }
  }

  private handleChatMessage(client: Client, payload: { text: string }): void {
    if (!client.room || !payload.text?.trim()) return

    const room = this.rooms.get(client.room)
    if (!room) return

    const chatMsg: ChatMessage = {
      id: this.generateMessageId(),
      userId: client.id,
      userName: client.name,
      text: payload.text.trim(),
      timestamp: Date.now(),
    }

    room.messages.push(chatMsg)

    this.broadcastToRoom(client.room, {
      type: WsMessageType.ChatMessage,
      payload: chatMsg,
    }, '')
  }

  private handleChatAudioMessage(client: Client, payload: { audioData: string; duration: number }): void {
    if (!client.room || !payload.audioData) return

    const room = this.rooms.get(client.room)
    if (!room) return

    const chatMsg: ChatMessage = {
      id: this.generateMessageId(),
      userId: client.id,
      userName: client.name,
      audioData: payload.audioData,
      duration: payload.duration,
      timestamp: Date.now(),
    }

    room.messages.push(chatMsg)

    this.broadcastToRoom(client.room, {
      type: WsMessageType.ChatAudioMessage,
      payload: chatMsg,
    }, '')
  }

  private handleChatVideoMessage(client: Client, payload: { videoData: string; duration: number }): void {
    if (!client.room || !payload.videoData) return

    const room = this.rooms.get(client.room)
    if (!room) return

    const chatMsg: ChatMessage = {
      id: this.generateMessageId(),
      userId: client.id,
      userName: client.name,
      videoData: payload.videoData,
      duration: payload.duration,
      timestamp: Date.now(),
    }

    room.messages.push(chatMsg)

    this.broadcastToRoom(client.room, {
      type: WsMessageType.ChatVideoMessage,
      payload: chatMsg,
    }, '')
  }

  private handleBinaryMessage(client: Client, data: Buffer): void {
    const roomId = client.room
    if (!roomId || data.length < 1) return

    const room = this.rooms.get(roomId)
    if (!room) return

    const userIdBuf = Buffer.from(client.id.padEnd(8, '\0').slice(0, 8), 'utf8')
    const out = Buffer.alloc(8 + data.length)
    userIdBuf.copy(out, 0)
    data.copy(out, 8)

    room.clients.forEach((c) => {
      if (c.id !== client.id && c.ws.readyState === 1) {
        try {
          c.ws.send(out)
        } catch {
          logger.warn('WsHandler', `Failed to send voice to ${c.id}`)
        }
      }
    })
  }

  private handlePrivateMessage(client: Client, payload: { toUserId: string; text: string }): void {
    if (!payload.toUserId || !payload.text?.trim()) return

    const target = this.clients.get(payload.toUserId)
    if (!target) return

    const msg = {
      type: WsMessageType.PrivateMessage,
      payload: {
        fromUserId: client.id,
        fromUserName: client.name,
        toUserId: payload.toUserId,
        text: payload.text.trim(),
        timestamp: Date.now(),
      },
    }

    this.send(target.ws, msg)
    this.send(client.ws, msg)
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
      payload: { roomId: room.id, roomName: room.name, messages: room.messages },
    })

    const liveBroadcast = this.rooms.getLiveBroadcast(room.id)
    if (liveBroadcast) {
      this.send(client.ws, {
        type: WsMessageType.LiveStarted,
        payload: { userId: liveBroadcast.userId, userName: liveBroadcast.userName },
      })
      if (liveBroadcast.initChunk) {
        this.send(client.ws, {
          type: WsMessageType.LiveChunkReceived,
          payload: { userId: liveBroadcast.userId, chunk: liveBroadcast.initChunk, duration: 0 },
        })
      }
    }

    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
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
    const live = this.rooms.getLiveBroadcast(roomId)
    if (live && live.userId === client.id) {
      this.rooms.clearLiveBroadcast(roomId)
      this.broadcastToRoom(roomId, {
        type: WsMessageType.LiveStopped,
        payload: { userId: client.id },
      }, '')
      if (live.takeoverRequesterId) {
        const requester = this.clients.get(live.takeoverRequesterId)
        if (requester) {
          this.send(requester.ws, {
            type: WsMessageType.LiveRequestResponse,
            payload: { allow: true, fromUserId: client.id },
          })
        }
      }
    }
    const userName = client.name
    this.send(client.ws, {
      type: WsMessageType.RoomLeft,
      payload: { roomId },
    })
    this.rooms.leave(roomId, client)
    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
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
      payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
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

    const room = this.rooms.get(roomId)
    if (!room) return

    // Notify all occupants they've been removed
    room.clients.forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(JSON.stringify({
          type: WsMessageType.RoomLeft,
          payload: { roomId },
        }))
      }
    })

    this.rooms.delete(roomId)

    this.broadcast({
      type: WsMessageType.RoomDeleted,
      payload: { roomId },
    })
    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
    })
    this.broadcast({
      type: WsMessageType.UserList,
      payload: this.clients.getAll().map((c) => ({
        id: c.id, name: c.name, room: c.room,
      })),
    })
  }

  private handleDisconnect(client: Client): void {
    const roomId = client.room
    const userName = client.name

    if (roomId) {
      const live = this.rooms.getLiveBroadcast(roomId)
      if (live && live.userId === client.id) {
        this.rooms.clearLiveBroadcast(roomId)
        this.broadcastToRoom(roomId, {
          type: WsMessageType.LiveStopped,
          payload: { userId: client.id },
        }, '')
        if (live.takeoverRequesterId) {
          const requester = this.clients.get(live.takeoverRequesterId)
          if (requester) {
            this.send(requester.ws, {
              type: WsMessageType.LiveRequestResponse,
              payload: { allow: true, fromUserId: client.id },
            })
          }
        }
      }
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
      payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
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

  private handleDeleteMessage(client: Client, payload: { messageId: string }): void {
    if (!client.room || !payload.messageId) return

    const room = this.rooms.get(client.room)
    if (!room) return

    const idx = room.messages.findIndex((m) => m.id === payload.messageId)
    if (idx === -1) return

    const msg = room.messages[idx]
    if (msg.userId !== client.id) return

    room.messages.splice(idx, 1)

    this.broadcastToRoom(client.room, {
      type: WsMessageType.MessageDeleted,
      payload: { messageId: payload.messageId },
    }, '')
  }

  private handleLiveStart(client: Client): void {
    const roomId = client.room
    if (!roomId) return

    const existing = this.rooms.getLiveBroadcast(roomId)
    if (existing) {
      const current = this.clients.get(existing.userId)
      if (current) {
        existing.takeoverRequesterId = client.id
        this.send(current.ws, {
          type: WsMessageType.LiveRequest,
          payload: { fromUserId: client.id, fromUserName: client.name },
        })
      }
      return
    }

    this.rooms.setLiveBroadcast(roomId, { userId: client.id, userName: client.name, timestamp: Date.now(), initChunk: undefined })
    this.broadcastToRoom(roomId, {
      type: WsMessageType.LiveStarted,
      payload: { userId: client.id, userName: client.name },
    }, '')
  }

  private handleLiveStop(client: Client): void {
    const roomId = client.room
    if (!roomId) return
    const live = this.rooms.getLiveBroadcast(roomId)
    if (!live || live.userId !== client.id) return

    this.rooms.clearLiveBroadcast(roomId)
    this.broadcastToRoom(roomId, {
      type: WsMessageType.LiveStopped,
      payload: { userId: client.id },
    }, '')

    // Auto-grant takeover to pending requester
    if (live.takeoverRequesterId) {
      const requester = this.clients.get(live.takeoverRequesterId)
      if (requester) {
        this.send(requester.ws, {
          type: WsMessageType.LiveRequestResponse,
          payload: { allow: true, fromUserId: client.id },
        })
      }
    }
  }

  private handleLiveChunk(client: Client, payload: { chunk: string; duration: number }): void {
    const roomId = client.room
    if (!roomId) return
    const live = this.rooms.getLiveBroadcast(roomId)
    if (!live || live.userId !== client.id) return

    if (!live.initChunk) {
      live.initChunk = payload.chunk
    }

    this.broadcastToRoom(roomId, {
      type: WsMessageType.LiveChunkReceived,
      payload: { userId: client.id, chunk: payload.chunk, duration: payload.duration },
    }, client.id)
  }

  private handleLiveRequestResponse(client: Client, payload: { allow: boolean; requesterId: string }): void {
    const roomId = client.room
    if (!roomId) return
    const live = this.rooms.getLiveBroadcast(roomId)
    if (!live || live.userId !== client.id) return

    const requester = this.clients.get(payload.requesterId)
    if (!requester) return

    if (payload.allow) {
      this.rooms.clearLiveBroadcast(roomId)
      this.broadcastToRoom(roomId, {
        type: WsMessageType.LiveStopped,
        payload: { userId: client.id },
      }, '')
      // Give the requester a moment then respond
      this.send(requester.ws, {
        type: WsMessageType.LiveRequestResponse,
        payload: { allow: true, fromUserId: client.id },
      })
    } else {
      live.takeoverRequesterId = undefined
      this.send(requester.ws, {
        type: WsMessageType.LiveRequestResponse,
        payload: { allow: false, fromUserId: client.id },
      })
    }
  }

  private handleLiveRequestCancel(client: Client): void {
    const roomId = client.room
    if (!roomId) return
    const live = this.rooms.getLiveBroadcast(roomId)
    if (!live || live.takeoverRequesterId !== client.id) return

    live.takeoverRequesterId = undefined
    const current = this.clients.get(live.userId)
    if (current) {
      this.send(current.ws, {
        type: WsMessageType.LiveRequestCancelled,
        payload: { fromUserId: client.id },
      })
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 10)
  }

  private generateMessageId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
  }
}
