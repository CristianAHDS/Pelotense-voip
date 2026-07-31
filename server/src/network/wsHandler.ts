import { WebSocketServer, WebSocket } from 'ws'
import { Client, ChatMessage, WsMessage, WsMessageType, LiveState, SecurityLimits, DEFAULT_SECURITY_LIMITS } from '../types/index.js'
import { ClientManager } from '../clients/index.js'
import { RoomManager } from '../rooms/index.js'
import { logger } from '../utils/logger.js'
import { eventBus } from '../utils/events.js'
import { EventType } from '../types/index.js'
import { SqliteStore } from '../storage/index.js'

export class WsHandler {
  private wss: WebSocketServer
  private clients: ClientManager
  private rooms: RoomManager
  private udpPort: number
  private limits: SecurityLimits
  private adminNames: string[]
  private adminIds: string[]
  private storage?: SqliteStore
  private pendingClients = new Map<WebSocket, { ip: string }>()
  private deadConnectionTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    wss: WebSocketServer,
    clients: ClientManager,
    rooms: RoomManager,
    udpPort: number,
    limits: SecurityLimits = DEFAULT_SECURITY_LIMITS,
    adminNames: string[] = [],
    storage?: SqliteStore,
    adminIds: string[] = [],
  ) {
    this.wss = wss
    this.clients = clients
    this.rooms = rooms
    this.udpPort = udpPort
    this.limits = limits
    this.adminNames = adminNames
    this.adminIds = adminIds
    this.storage = storage
    this.setup()
    this.startDeadConnectionMonitor()
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

  private startDeadConnectionMonitor(): void {
    this.deadConnectionTimer = setInterval(() => {
      this.checkDeadConnections(30000)
    }, 15000)
    this.deadConnectionTimer.unref?.()
  }

  checkDeadConnections(timeoutMs: number): void {
    const now = Date.now()
    for (const client of this.clients.getAll()) {
      if (now - client.lastPing > timeoutMs) {
        logger.warn('WsHandler', `Terminating dead connection ${client.id} (${client.name})`)
        this.handleDisconnect(client)
        try {
          client.ws.terminate()
        } catch { /* ignore */ }
      }
    }
  }

  private handleLogin(ws: WebSocket, payload: { name: string; password: string; avatar?: string }): void {
    const pending = this.pendingClients.get(ws)
    if (!pending) return

    const { name, password, avatar } = payload
    if (!name || !password) {
      this.send(ws, { type: WsMessageType.Error, payload: 'Name and password required' })
      ws.close()
      return
    }
    if (name.length > this.limits.maxNameLength) {
      this.send(ws, { type: WsMessageType.Error, payload: 'Name too long' })
      ws.close()
      return
    }
    if (password.length > this.limits.maxPasswordLength) {
      this.send(ws, { type: WsMessageType.Error, payload: 'Password too long' })
      ws.close()
      return
    }
    if (avatar !== undefined && this.base64Exceeds(avatar, this.limits.maxAvatarBytes)) {
      this.send(ws, { type: WsMessageType.Error, payload: 'Avatar too large' })
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
    } else if (this.storage) {
      // Conta persistida: valida a senha mesmo sem ninguém online.
      const account = this.storage.getAccount(name)
      if (account && account.password !== password) {
        this.send(ws, { type: WsMessageType.Error, payload: 'Wrong password' })
        ws.close()
        return
      }
    }

    let accountId: string | undefined
    let accountAvatar: string | undefined
    if (this.storage) {
      const account = this.storage.getAccount(name)
      if (account) {
        accountId = account.id
        accountAvatar = account.avatar
      }
    }

    const id = accountId ?? this.generateId()
    const client: Client = {
      id,
      name,
      password,
      room: null,
      udpPort: 0,
      ip: pending.ip,
      lastPing: Date.now(),
      admin: this.adminNames.includes(name) || this.adminIds.includes(id),
      avatar: avatar ?? accountAvatar,
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
      payload: { id: client.id, name: client.name, udpPort: this.udpPort, admin: client.admin, avatar: client.avatar },
    })

    if (this.storage) {
      this.storage.saveAccount({ name: client.name, id: client.id, password: client.password, avatar: client.avatar })
    }

    this.broadcast({
      type: WsMessageType.UserList,
      payload: this.clients.getAll().map((c) => this.toUserPayload(c)),
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
      payload: this.clients.getAll().map((c) => this.toUserPayload(c)),
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
          payload: this.clients.getAll().map((c) => this.toUserPayload(c)),
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

      case WsMessageType.ChatImageMessage:
        this.handleChatImageMessage(client, msg.payload as { imageData: string })
        break

      case WsMessageType.MessageReaction:
        this.handleMessageReaction(client, msg.payload as { messageId: string; emoji: string })
        break

      case WsMessageType.ForwardMessage:
        this.handleForwardMessage(client, msg.payload as { messageId: string; roomName: string })
        break

      case WsMessageType.DeleteMessage:
        this.handleDeleteMessage(client, msg.payload as { messageId: string })
        break

      case WsMessageType.PrivateMessage:
        this.handlePrivateMessage(client, msg.payload as { toUserId: string; text: string })
        break

      case WsMessageType.PrivateAudioMessage:
        this.handlePrivateAudioMessage(client, msg.payload as { toUserId: string; audioData: string; duration: number })
        break

      case WsMessageType.PrivateVideoMessage:
        this.handlePrivateVideoMessage(client, msg.payload as { toUserId: string; videoData: string; duration: number })
        break

      case WsMessageType.ListPrivateMessages:
        this.handleListPrivateMessages(client, msg.payload as { withUserId: string })
        break

      case WsMessageType.UpdateProfile:
        this.handleUpdateProfile(client, msg.payload as { name?: string; password?: string; avatar?: string })
        break

      case WsMessageType.LiveForceStop:
        this.handleLiveForceStop(client, msg.payload as { targetUserId: string })
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
    if (payload.text.length > this.limits.maxTextLength) {
      logger.warn('WsHandler', `Chat message from ${client.id} exceeds ${this.limits.maxTextLength} chars, dropped`)
      return
    }

    const room = this.rooms.get(client.room)
    if (!room) return

    const chatMsg: ChatMessage = {
      id: this.generateMessageId(),
      userId: client.id,
      userName: client.name,
      text: payload.text.trim(),
      timestamp: Date.now(),
    }

    this.rooms.addMessage(room.id, chatMsg)

    this.broadcastToRoom(client.room, {
      type: WsMessageType.ChatMessage,
      payload: chatMsg,
    }, '')
  }

  private handleChatAudioMessage(client: Client, payload: { id?: string; audioData: string; duration: number }): void {
    if (!client.room || !payload.audioData) return
    if (this.base64Exceeds(payload.audioData, this.limits.maxAudioMessageBytes)) {
      logger.warn('WsHandler', `Audio message from ${client.id} exceeds ${this.limits.maxAudioMessageBytes} bytes, dropped`)
      return
    }

    const room = this.rooms.get(client.room)
    if (!room) return

    const chatMsg: ChatMessage = {
      // id do cliente (mensagem otimista) é preservado para o eco ser
      // correlacionado no remetente; sem ele, gera um novo.
      id: typeof payload.id === 'string' && payload.id ? payload.id : this.generateMessageId(),
      userId: client.id,
      userName: client.name,
      audioData: payload.audioData,
      duration: payload.duration,
      timestamp: Date.now(),
    }

    this.rooms.addMessage(room.id, chatMsg)

    this.broadcastToRoom(client.room, {
      type: WsMessageType.ChatAudioMessage,
      payload: chatMsg,
    }, '')
  }

  private handleChatVideoMessage(client: Client, payload: { id?: string; videoData: string; duration: number }): void {
    if (!client.room || !payload.videoData) return
    if (this.base64Exceeds(payload.videoData, this.limits.maxVideoMessageBytes)) {
      logger.warn('WsHandler', `Video message from ${client.id} exceeds ${this.limits.maxVideoMessageBytes} bytes, dropped`)
      return
    }

    const room = this.rooms.get(client.room)
    if (!room) return

    const chatMsg: ChatMessage = {
      id: typeof payload.id === 'string' && payload.id ? payload.id : this.generateMessageId(),
      userId: client.id,
      userName: client.name,
      videoData: payload.videoData,
      duration: payload.duration,
      timestamp: Date.now(),
    }

    this.rooms.addMessage(room.id, chatMsg)

    this.broadcastToRoom(client.room, {
      type: WsMessageType.ChatVideoMessage,
      payload: chatMsg,
    }, '')
  }

  private handleChatImageMessage(client: Client, payload: { id?: string; imageData: string }): void {
    if (!client.room || !payload.imageData) return
    if (this.base64Exceeds(payload.imageData, this.limits.maxImageMessageBytes)) {
      logger.warn('WsHandler', `Image message from ${client.id} exceeds ${this.limits.maxImageMessageBytes} bytes, dropped`)
      return
    }

    const room = this.rooms.get(client.room)
    if (!room) return

    const chatMsg: ChatMessage = {
      id: typeof payload.id === 'string' && payload.id ? payload.id : this.generateMessageId(),
      userId: client.id,
      userName: client.name,
      imageData: payload.imageData,
      timestamp: Date.now(),
    }

    this.rooms.addMessage(room.id, chatMsg)

    this.broadcastToRoom(client.room, {
      type: WsMessageType.ChatImageMessage,
      payload: chatMsg,
    }, '')
  }

  private handleMessageReaction(client: Client, payload: { messageId: string; emoji: string }): void {
    if (!client.room || !payload.messageId) return
    const emoji = payload.emoji?.trim()
    if (!emoji || emoji.length > 16) return

    const room = this.rooms.get(client.room)
    if (!room) return

    const msg = room.messages.find((m) => m.id === payload.messageId)
    if (!msg) return

    if (msg.userId === client.id) return

    msg.reactions ??= []
    let entry = msg.reactions.find((r) => r.emoji === emoji)
    if (!entry) {
      entry = { emoji, userIds: [] }
      msg.reactions.push(entry)
    }

    const idx = entry.userIds.indexOf(client.id)
    if (idx >= 0) {
      entry.userIds.splice(idx, 1)
    } else {
      entry.userIds.push(client.id)
    }
    if (entry.userIds.length === 0) {
      msg.reactions = msg.reactions.filter((r) => r.emoji !== emoji)
    }

    this.rooms.updateMessage(room.id, msg)

    this.broadcastToRoom(client.room, {
      type: WsMessageType.MessageReaction,
      payload: msg,
    }, '')
  }

  private handleForwardMessage(client: Client, payload: { messageId: string; roomName: string }): void {
    if (!client.room || !payload.messageId || !payload.roomName) return
    const room = this.rooms.get(client.room)
    if (!room) return

    const source = room.messages.find((m) => m.id === payload.messageId)
    if (!source) return

    const target = this.rooms.findByName(payload.roomName)
    if (!target) return

    const copy: ChatMessage = {
      ...source,
      id: this.generateMessageId(),
      forwarded: true,
      timestamp: Date.now(),
      reactions: undefined,
    }

    this.rooms.addMessage(target.id, copy)

    const type = copy.audioData
      ? WsMessageType.ChatAudioMessage
      : copy.videoData
        ? WsMessageType.ChatVideoMessage
        : copy.imageData
          ? WsMessageType.ChatImageMessage
          : WsMessageType.ChatMessage

    this.broadcastToRoom(target.id, { type, payload: copy }, '')
  }

  private handleBinaryMessage(client: Client, data: Buffer): void {
    const roomId = client.room
    if (!roomId || data.length < 1) return
    if (data.length > this.limits.maxVoiceFrameBytes) {
      logger.warn('WsHandler', `Voice frame from ${client.id} exceeds ${this.limits.maxVoiceFrameBytes} bytes, dropped`)
      return
    }

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
    if (payload.text.length > this.limits.maxTextLength) {
      logger.warn('WsHandler', `Private message from ${client.id} exceeds ${this.limits.maxTextLength} chars, dropped`)
      return
    }

    const target = this.clients.get(payload.toUserId)
    if (!target) return

    const msg = {
      type: WsMessageType.PrivateMessage,
      payload: {
        id: this.generateMessageId(),
        fromUserId: client.id,
        fromUserName: client.name,
        toUserId: payload.toUserId,
        toUserName: target.name,
        text: payload.text.trim(),
        timestamp: Date.now(),
      },
    }

    this.storage?.savePrivateMessage(msg.payload)

    this.send(target.ws, msg)
    this.send(client.ws, msg)
  }

  private handlePrivateAudioMessage(client: Client, payload: { toUserId: string; id?: string; audioData: string; duration: number }): void {
    if (!payload.toUserId || !payload.audioData) return
    if (this.base64Exceeds(payload.audioData, this.limits.maxAudioMessageBytes)) {
      logger.warn('WsHandler', `Private audio message from ${client.id} exceeds ${this.limits.maxAudioMessageBytes} bytes, dropped`)
      return
    }

    const target = this.clients.get(payload.toUserId)
    if (!target) return

    const msg = {
      type: WsMessageType.PrivateAudioMessage,
      payload: {
        id: typeof payload.id === 'string' && payload.id ? payload.id : this.generateMessageId(),
        fromUserId: client.id,
        fromUserName: client.name,
        toUserId: payload.toUserId,
        toUserName: target.name,
        audioData: payload.audioData,
        duration: payload.duration,
        timestamp: Date.now(),
      },
    }

    this.storage?.savePrivateMessage(msg.payload)

    this.send(target.ws, msg)
    this.send(client.ws, msg)
  }

  private handlePrivateVideoMessage(client: Client, payload: { toUserId: string; id?: string; videoData: string; duration: number }): void {
    if (!payload.toUserId || !payload.videoData) return
    if (this.base64Exceeds(payload.videoData, this.limits.maxVideoMessageBytes)) {
      logger.warn('WsHandler', `Private video message from ${client.id} exceeds ${this.limits.maxVideoMessageBytes} bytes, dropped`)
      return
    }

    const target = this.clients.get(payload.toUserId)
    if (!target) return

    const msg = {
      type: WsMessageType.PrivateVideoMessage,
      payload: {
        id: typeof payload.id === 'string' && payload.id ? payload.id : this.generateMessageId(),
        fromUserId: client.id,
        fromUserName: client.name,
        toUserId: payload.toUserId,
        toUserName: target.name,
        videoData: payload.videoData,
        duration: payload.duration,
        timestamp: Date.now(),
      },
    }

    this.storage?.savePrivateMessage(msg.payload)

    this.send(target.ws, msg)
    this.send(client.ws, msg)
  }

  private handleListPrivateMessages(client: Client, payload: { withUserId: string }): void {
    if (!payload.withUserId || !this.storage) return
    const peer = this.clients.get(payload.withUserId)
    if (!peer) {
      this.send(client.ws, {
        type: WsMessageType.PrivateHistory,
        payload: { withUserId: payload.withUserId, messages: [] },
      })
      return
    }
    const messages = this.storage.loadPrivateMessages(client.name, peer.name)
    this.send(client.ws, {
      type: WsMessageType.PrivateHistory,
      payload: { withUserId: payload.withUserId, messages },
    })
  }

  private handleUpdateProfile(client: Client, payload: { name?: string; password?: string; avatar?: string }): void {
    const name = typeof payload.name === 'string' ? payload.name.trim() : client.name
    if (!name) {
      this.send(client.ws, { type: WsMessageType.Error, payload: 'Name required' })
      return
    }
    if (name.length > this.limits.maxNameLength) {
      this.send(client.ws, { type: WsMessageType.Error, payload: 'Name too long' })
      return
    }
    const password = typeof payload.password === 'string' ? payload.password : client.password
    if (password.length > this.limits.maxPasswordLength) {
      this.send(client.ws, { type: WsMessageType.Error, payload: 'Password too long' })
      return
    }
    if (payload.avatar !== undefined && this.base64Exceeds(payload.avatar, this.limits.maxAvatarBytes)) {
      this.send(client.ws, { type: WsMessageType.Error, payload: 'Avatar too large' })
      return
    }
    if (name !== client.name) {
      const taken = this.clients.getAll().find((c) => c.id !== client.id && c.name === name)
      if (taken) {
        this.send(client.ws, { type: WsMessageType.Error, payload: 'Name in use' })
        return
      }
      if (this.storage && this.storage.getAccount(name) && this.storage.getAccount(name)!.password !== password) {
        this.send(client.ws, { type: WsMessageType.Error, payload: 'Wrong password' })
        return
      }
    }

    const oldName = client.name
    client.name = name
    client.password = password
    if (payload.avatar !== undefined) {
      client.avatar = payload.avatar || undefined
    }

    if (this.storage) {
      const id = client.id
      if (name !== oldName) {
        this.storage.renameAccount(oldName, { name, id, password, avatar: client.avatar })
      } else {
        this.storage.saveAccount({ name, id, password, avatar: client.avatar })
      }
    }

    this.send(client.ws, {
      type: WsMessageType.ProfileUpdated,
      payload: { id: client.id, name, avatar: client.avatar },
    })
    this.broadcast({
      type: WsMessageType.UserList,
      payload: this.clients.getAll().map((c) => this.toUserPayload(c)),
    })
  }

  private stopBroadcastForLeaving(client: Client, roomId: string): void {
    const live = this.rooms.getLiveBroadcast(roomId)
    if (!live || live.userId !== client.id) return

    this.rooms.clearLiveBroadcast(roomId)
    this.broadcastToRoom(roomId, {
      type: WsMessageType.LiveStopped,
      payload: { userId: client.id },
    }, '')
    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
    })
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

  private handleJoinRoom(client: Client, roomName: string): void {
    if (!roomName) {
      this.send(client.ws, {
        type: WsMessageType.Error,
        payload: 'Room name required',
      })
      return
    }
    if (roomName.length > this.limits.maxRoomNameLength) {
      logger.warn('WsHandler', `Join room name from ${client.id} exceeds ${this.limits.maxRoomNameLength} chars, dropped`)
      return
    }

    let room = this.rooms.findByName(roomName)
    if (!room) {
      room = this.rooms.create(roomName, client.id, client.name)
      if (!room) {
        this.send(client.ws, {
          type: WsMessageType.Error,
          payload: 'Cannot create room',
        })
        return
      }
    }

    if (client.room) {
      this.stopBroadcastForLeaving(client, client.room)
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
      payload: this.clients.getAll().map((c) => this.toUserPayload(c)),
    })
  }

  private handleLeaveRoom(client: Client): void {
    if (!client.room) return
    const roomId = client.room
    this.stopBroadcastForLeaving(client, roomId)

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
      payload: this.clients.getAll().map((c) => this.toUserPayload(c)),
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
    if (roomName.length > this.limits.maxRoomNameLength) {
      logger.warn('WsHandler', `Create room name from ${client.id} exceeds ${this.limits.maxRoomNameLength} chars, dropped`)
      return
    }
    const room = this.rooms.create(roomName, client.id, client.name)
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

    if (room.createdBy && room.createdBy !== client.id && !client.admin) {
      logger.warn('WsHandler', `${client.name} (${client.id}) tried to delete room ${room.name} without permission`)
      return
    }

    const live = this.rooms.getLiveBroadcast(roomId)
    if (live) {
      this.rooms.clearLiveBroadcast(roomId)
    }

    // Notify all occupants they've been removed
    room.clients.forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) {
        if (live && c.id === live.userId) {
          c.ws.send(JSON.stringify({
            type: WsMessageType.LiveStopped,
            payload: { userId: c.id },
          }))
        }
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
      payload: this.clients.getAll().map((c) => this.toUserPayload(c)),
    })
  }

  private handleDisconnect(client: Client): void {
    if (!this.clients.has(client.id)) return
    const roomId = client.room
    const userName = client.name

    if (roomId) {
      this.stopBroadcastForLeaving(client, roomId)
      this.rooms.leave(roomId, client)
    }
    this.clients.remove(client.id)
    this.broadcast({
      type: WsMessageType.UserList,
      payload: this.clients.getAll().map((c) => this.toUserPayload(c)),
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
    if (msg.userId !== client.id && !client.admin) return

    this.rooms.deleteMessage(room.id, payload.messageId)

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
    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
    })
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

    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
    })

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

  private handleLiveForceStop(client: Client, payload: { targetUserId: string }): void {
    const roomId = client.room
    if (!roomId || !payload.targetUserId) return
    if (!client.admin) {
      logger.warn('WsHandler', `${client.name} (${client.id}) tried to force-stop a live without admin`)
      return
    }
    const live = this.rooms.getLiveBroadcast(roomId)
    if (!live || live.userId !== payload.targetUserId) return

    this.rooms.clearLiveBroadcast(roomId)
    this.broadcastToRoom(roomId, {
      type: WsMessageType.LiveStopped,
      payload: { userId: live.userId },
    }, '')

    this.broadcast({
      type: WsMessageType.RoomList,
      payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)),
    })

    if (live.takeoverRequesterId) {
      const requester = this.clients.get(live.takeoverRequesterId)
      if (requester) {
        this.send(requester.ws, {
          type: WsMessageType.LiveRequestResponse,
          payload: { allow: true, fromUserId: live.userId },
        })
      }
    }
    logger.info('WsHandler', `Admin ${client.name} force-stopped live of ${live.userName}`)
  }

  private handleLiveChunk(client: Client, payload: { chunk: string; duration: number }): void {
    const roomId = client.room
    if (!roomId) return
    const live = this.rooms.getLiveBroadcast(roomId)
    if (!live || live.userId !== client.id) return
    if (this.base64Exceeds(payload.chunk, this.limits.maxLiveChunkBytes)) {
      logger.warn('WsHandler', `Live chunk from ${client.id} exceeds ${this.limits.maxLiveChunkBytes} bytes, dropped`)
      return
    }

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

  private base64Exceeds(data: string, maxBytes: number): boolean {
    return data.length > Math.ceil((maxBytes * 4) / 3) + 4
  }

  private toUserPayload(client: Client): { id: string; name: string; room: string | null; admin: boolean; avatar?: string } {
    return {
      id: client.id,
      name: client.name,
      room: client.room,
      admin: client.admin,
      avatar: client.avatar,
    }
  }
}
