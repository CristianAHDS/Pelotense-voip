import { WebSocketServer, WebSocket } from 'ws'
import { Client, ChatMessage, WsMessage, WsMessageType, LiveState, SecurityLimits, DEFAULT_SECURITY_LIMITS } from '../types/index.js'
import { ClientManager } from '../clients/index.js'
import { RoomManager } from '../rooms/index.js'
import { logger } from '../utils/logger.js'
import { eventBus } from '../utils/events.js'
import { EventType } from '../types/index.js'
import { SqliteStore } from '../storage/index.js'

const MASTER_USER_ID = 'fc2su3qi'

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

      let loginTimer: ReturnType<typeof setTimeout> | null = null

      const armLoginTimer = () => {
        if (loginTimer) clearTimeout(loginTimer)
        loginTimer = setTimeout(() => {
          if (this.pendingClients.has(ws)) {
            this.send(ws, { type: WsMessageType.Error, payload: 'Login timeout' })
            ws.close()
          }
        }, 120000)
      }

      const onMessage = (data: Buffer) => {
        try {
          const msg: WsMessage = JSON.parse(data.toString())
          if (msg.type === WsMessageType.Login) {
            armLoginTimer()
            this.handleLogin(ws, msg.payload as { name: string; email?: string; password: string; avatar?: string })
          } else {
            this.send(ws, { type: WsMessageType.Error, payload: 'Login first' })
            ws.close()
          }
        } catch {
          logger.warn('WsHandler', 'Invalid message during login')
          ws.close()
        }
      }

      const cleanup = () => {
        if (loginTimer) clearTimeout(loginTimer)
        ws.off('message', onMessage)
        this.pendingClients.delete(ws)
      }

      armLoginTimer()
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

  private handleLogin(ws: WebSocket, payload: { name: string; email?: string; password: string; avatar?: string; intent?: string }): void {
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

    // `name` pode ser nick ou e-mail. `email` é opcional (usado na criação/login por e-mail).
    const identifier = name.trim()
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
    if (email && !this.isValidEmail(email)) {
      this.send(ws, { type: WsMessageType.Error, payload: 'Invalid email' })
      ws.close()
      return
    }

    const intent = typeof payload.intent === 'string' ? payload.intent : ''
    const isEmailIdentifier = identifier.includes('@')
    let account = this.storage?.getAccountByIdentifier(identifier)

    // Se informou um e-mail que já pertence a outra conta, impede o uso.
    if (email && this.storage) {
      const owner = this.storage.getAccountByEmail(email)
      if (owner && owner.name !== (account?.name ?? identifier)) {
        this.send(ws, { type: WsMessageType.Error, payload: 'Email in use' })
        ws.close()
        return
      }
    }

    if (intent === 'register') {
      // Registro tradicional: exige e-mail e nome livre.
      if (!email) {
        this.send(ws, { type: WsMessageType.Error, payload: 'Email required' })
        ws.close()
        return
      }
      if (account) {
        this.send(ws, { type: WsMessageType.Error, payload: 'Name in use' })
        ws.close()
        return
      }
      account = {
        name: identifier,
        id: this.generateId(),
        email,
        password,
        avatar,
        emailConfirmed: true,
        createdAt: Date.now(),
      }
      this.storage?.saveAccount(account)
    } else if (intent === 'login') {
      // Login tradicional: a conta precisa já existir.
      if (!account && !isEmailIdentifier) {
        this.send(ws, { type: WsMessageType.Error, payload: 'Account not found' })
        ws.close()
        return
      }
    } else {
      // Sem intent: mantém o comportamento legado (nick novo cria conta na hora).
      if (!account && !isEmailIdentifier) {
        account = {
          name: identifier,
          id: this.generateId(),
          email: email || undefined,
          password,
          avatar,
          emailConfirmed: true,
          createdAt: Date.now(),
        }
        this.storage?.saveAccount(account)
      }
    }

    if (!account) {
      // E-mail digitado como identificador sem conta cadastrada.
      this.send(ws, { type: WsMessageType.Error, payload: 'Email not registered' })
      ws.close()
      return
    }

    if (account.password !== password) {
      this.send(ws, { type: WsMessageType.Error, payload: 'Wrong password' })
      ws.close()
      return
    }

    // Associa e-mail à conta caso tenha sido informado e ainda não exista.
    if (email && this.storage && account && !account.email) {
      account.email = email
      this.storage.saveAccount(account)
    }

    const resolvedName = account.name
    const existing = this.clients.findByName(resolvedName)
    if (existing) {
      if (existing.password !== password) {
        this.send(ws, { type: WsMessageType.Error, payload: 'Wrong password' })
        ws.close()
        return
      }
      this.removeExistingClient(existing)
    }

    const id = account.id ?? this.generateId()
    const client: Client = {
      id,
      name: resolvedName,
      password,
      room: null,
      udpPort: 0,
      ip: pending.ip,
      lastPing: Date.now(),
      admin: id === MASTER_USER_ID || this.adminNames.includes(resolvedName) || this.adminIds.includes(id) || account.isAdmin === true,
      avatar: avatar ?? account.avatar,
      email: account.email,
      tags: account.tags,
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
      payload: { id: client.id, name: client.name, udpPort: this.udpPort, admin: client.admin, avatar: client.avatar, email: client.email },
    })

    if (this.storage) {
      this.storage.saveAccount({ name: client.name, id: client.id, email: client.email, password: client.password, avatar: client.avatar })
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

      case WsMessageType.ListAccounts:
        this.handleListAccounts(client)
        break

      case WsMessageType.AdminUpdateAccount:
        this.handleAdminUpdateAccount(client, msg.payload as { userId?: string; userName?: string; name?: string; email?: string; password?: string; isAdmin?: boolean; tags?: string[] })
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

      case WsMessageType.PrivateImageMessage:
        this.handlePrivateImageMessage(client, msg.payload as { toUserId: string; id?: string; imageData: string })
        break

      case WsMessageType.DeletePrivateMessage:
        this.handleDeletePrivateMessage(client, msg.payload as { messageId: string })
        break

      case WsMessageType.ListPrivateMessages:
        this.handleListPrivateMessages(client, msg.payload as { withUserId: string })
        break

      case WsMessageType.UpdateProfile:
        this.handleUpdateProfile(client, msg.payload as { name?: string; email?: string; password?: string; avatar?: string })
        break

      case WsMessageType.LiveForceStop:
        this.handleLiveForceStop(client, msg.payload as { targetUserId: string })
        break

      case WsMessageType.RTCSignal:
        this.handleRTCSignal(client, msg.payload as { toUserId: string; sdp?: unknown; candidate?: unknown })
        break

      case WsMessageType.RequestLivePreview:
        this.handleRequestLivePreview(client, msg.payload as { broadcasterUserId: string })
        break

      case WsMessageType.LiveStart:
        this.handleLiveStart(client, msg.payload as { mime?: string } | undefined)
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

  private handlePrivateMessage(client: Client, payload: { toUserId: string; text: string; id?: string }): void {
    if (!payload.toUserId || !payload.text?.trim()) return
    if (payload.text.length > this.limits.maxTextLength) {
      logger.warn('WsHandler', `Private message from ${client.id} exceeds ${this.limits.maxTextLength} chars, dropped`)
      return
    }

    const resolved = this.resolvePrivateTarget(payload.toUserId)
    if (!resolved) return

    const msg = {
      type: WsMessageType.PrivateMessage,
      payload: {
        id: typeof payload.id === 'string' && payload.id ? payload.id : this.generateMessageId(),
        fromUserId: client.id,
        fromUserName: client.name,
        toUserId: payload.toUserId,
        toUserName: resolved.name,
        text: payload.text.trim(),
        timestamp: Date.now(),
      },
    }

    this.storage?.savePrivateMessage(msg.payload)

    if (resolved.ws) this.send(resolved.ws, msg)
    this.send(client.ws, msg)
  }

  private handlePrivateAudioMessage(client: Client, payload: { toUserId: string; id?: string; audioData: string; duration: number }): void {
    if (!payload.toUserId || !payload.audioData) return
    if (this.base64Exceeds(payload.audioData, this.limits.maxAudioMessageBytes)) {
      logger.warn('WsHandler', `Private audio message from ${client.id} exceeds ${this.limits.maxAudioMessageBytes} bytes, dropped`)
      return
    }

    const resolved = this.resolvePrivateTarget(payload.toUserId)
    if (!resolved) return

    const msg = {
      type: WsMessageType.PrivateAudioMessage,
      payload: {
        id: typeof payload.id === 'string' && payload.id ? payload.id : this.generateMessageId(),
        fromUserId: client.id,
        fromUserName: client.name,
        toUserId: payload.toUserId,
        toUserName: resolved.name,
        audioData: payload.audioData,
        duration: payload.duration,
        timestamp: Date.now(),
      },
    }

    this.storage?.savePrivateMessage(msg.payload)

    if (resolved.ws) this.send(resolved.ws, msg)
    this.send(client.ws, msg)
  }

  private handlePrivateVideoMessage(client: Client, payload: { toUserId: string; id?: string; videoData: string; duration: number }): void {
    if (!payload.toUserId || !payload.videoData) return
    if (this.base64Exceeds(payload.videoData, this.limits.maxVideoMessageBytes)) {
      logger.warn('WsHandler', `Private video message from ${client.id} exceeds ${this.limits.maxVideoMessageBytes} bytes, dropped`)
      return
    }

    const resolved = this.resolvePrivateTarget(payload.toUserId)
    if (!resolved) return

    const msg = {
      type: WsMessageType.PrivateVideoMessage,
      payload: {
        id: typeof payload.id === 'string' && payload.id ? payload.id : this.generateMessageId(),
        fromUserId: client.id,
        fromUserName: client.name,
        toUserId: payload.toUserId,
        toUserName: resolved.name,
        videoData: payload.videoData,
        duration: payload.duration,
        timestamp: Date.now(),
      },
    }

    this.storage?.savePrivateMessage(msg.payload)

    if (resolved.ws) this.send(resolved.ws, msg)
    this.send(client.ws, msg)
  }

  private handlePrivateImageMessage(client: Client, payload: { toUserId: string; id?: string; imageData: string }): void {
    if (!payload.toUserId || !payload.imageData) return
    if (this.base64Exceeds(payload.imageData, this.limits.maxImageMessageBytes)) {
      logger.warn('WsHandler', `Private image message from ${client.id} exceeds ${this.limits.maxImageMessageBytes} bytes, dropped`)
      return
    }

    const resolved = this.resolvePrivateTarget(payload.toUserId)
    if (!resolved) return

    const msg = {
      type: WsMessageType.PrivateImageMessage,
      payload: {
        id: typeof payload.id === 'string' && payload.id ? payload.id : this.generateMessageId(),
        fromUserId: client.id,
        fromUserName: client.name,
        toUserId: payload.toUserId,
        toUserName: resolved.name,
        imageData: payload.imageData,
        timestamp: Date.now(),
      },
    }

    this.storage?.savePrivateMessage(msg.payload)

    if (resolved.ws) this.send(resolved.ws, msg)
    this.send(client.ws, msg)
  }

  private handleDeletePrivateMessage(client: Client, payload: { messageId: string }): void {
    if (!payload.messageId || !this.storage) return

    const msg = this.storage.getPrivateMessage(payload.messageId)
    if (!msg) return

    // Só o autor (ou admin) apaga a mensagem privada.
    if (msg.fromUserId !== client.id && !client.admin) return

    this.storage.deletePrivateMessage(payload.messageId)

    const peers = [msg.fromUserId, msg.toUserId]
    peers.forEach((id) => {
      const c = this.clients.get(id)
      if (c) {
        this.send(c.ws, {
          type: WsMessageType.PrivateMessageDeleted,
          payload: { messageId: payload.messageId },
        })
      }
    })
  }

  // Resolve o destinatário de uma mensagem privada: cliente online ou conta
  // cadastrada (offline). Permite persistir mensagens mesmo com o alvo offline.
  private resolvePrivateTarget(userId: string): { ws: WebSocket | null; name: string } | null {
    const target = this.clients.get(userId)
    if (target) return { ws: target.ws, name: target.name }
    if (this.storage) {
      const acc = this.storage.getAccountById(userId)
      if (acc) return { ws: null, name: acc.name }
    }
    return null
  }

  private handleListAccounts(client: Client): void {
    if (!this.storage) {
      this.send(client.ws, { type: WsMessageType.AccountsList, payload: [] })
      return
    }
    this.send(client.ws, { type: WsMessageType.AccountsList, payload: this.buildAccountsList() })
  }

  private isAccountAdmin(a: { id?: string; name: string; isAdmin?: boolean }): boolean {
    return a.id === MASTER_USER_ID
      || (!!a.id && this.adminIds.includes(a.id))
      || this.adminNames.includes(a.name)
      || a.isAdmin === true
  }

  private buildAccountsList(): Array<{ id?: string; name: string; email?: string; avatar?: string; admin: boolean; online: boolean; tags?: string[] }> {
    const onlineIds = new Set(this.clients.getAll().map((c) => c.id))
    return this.storage!.getAllAccounts().map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      avatar: a.avatar,
      admin: this.isAccountAdmin(a),
      online: !!a.id && onlineIds.has(a.id),
      tags: a.tags,
    }))
  }

  private handleAdminUpdateAccount(client: Client, payload: { userId?: string; userName?: string; name?: string; email?: string; password?: string; isAdmin?: boolean; tags?: string[] }): void {
    if (!client.admin) {
      logger.warn('WsHandler', `${client.name} (${client.id}) tried to update another account without admin`)
      return
    }
    if (!this.storage) {
      this.send(client.ws, { type: WsMessageType.Error, payload: 'Storage unavailable' })
      return
    }

    const target = payload.userId
      ? this.storage.getAccountById(payload.userId)
      : payload.userName
        ? this.storage.getAccount(payload.userName)
        : undefined
    if (!target) {
      this.send(client.ws, { type: WsMessageType.Error, payload: 'Account not found' })
      return
    }

    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : target.name
    if (name.length > this.limits.maxNameLength) {
      this.send(client.ws, { type: WsMessageType.Error, payload: 'Name too long' })
      return
    }
    const email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim().toLowerCase() : (target.email ?? '')
    if (email && !this.isValidEmail(email)) {
      this.send(client.ws, { type: WsMessageType.Error, payload: 'Invalid email' })
      return
    }
    const password = typeof payload.password === 'string' && payload.password ? payload.password : target.password
    if (password.length > this.limits.maxPasswordLength) {
      this.send(client.ws, { type: WsMessageType.Error, payload: 'Password too long' })
      return
    }

    if (name !== target.name) {
      const byName = this.storage.getAccount(name)
      const onlineTaken = this.clients.getAll().find((c) => c.id !== target.id && c.name === name)
      if (byName || onlineTaken) {
        this.send(client.ws, { type: WsMessageType.Error, payload: 'Name in use' })
        return
      }
    }
    if (email && email !== target.email) {
      const byEmail = this.storage.getAccountByEmail(email)
      if (byEmail && byEmail.name !== target.name) {
        this.send(client.ws, { type: WsMessageType.Error, payload: 'Email in use' })
        return
      }
    }

    const oldName = target.name
    const isAdmin = typeof payload.isAdmin === 'boolean' ? payload.isAdmin : target.isAdmin === true
    if (target.id === MASTER_USER_ID && !isAdmin) {
      this.send(client.ws, { type: WsMessageType.Error, payload: 'Master admin cannot be demoted' })
      return
    }
    const tags = Array.isArray(payload.tags)
      ? payload.tags.filter((t) => typeof t === 'string' && t.length > 0 && t.length <= 32).slice(0, 10)
      : target.tags
    const updated = { name, id: target.id, email: email || undefined, password, avatar: target.avatar, isAdmin, tags }
    if (name !== oldName) {
      this.storage.renameAccount(oldName, updated)
    } else {
      this.storage.saveAccount(updated)
    }

    // Se o alvo está online, atualiza a sessão dele para refletir as mudanças.
    const onlineTarget = this.clients.getAll().find((c) => c.id === target.id)
    if (onlineTarget) {
      onlineTarget.name = name
      onlineTarget.email = email || undefined
      onlineTarget.password = password
      onlineTarget.admin = this.isAccountAdmin(updated)
      onlineTarget.tags = tags
      this.broadcast({
        type: WsMessageType.UserList,
        payload: this.clients.getAll().map((c) => this.toUserPayload(c)),
      })
    }

    this.broadcast({ type: WsMessageType.AccountsList, payload: this.buildAccountsList() })
    logger.info('WsHandler', `Admin ${client.name} updated account ${oldName} -> ${name}`)
  }

  private handleListPrivateMessages(client: Client, payload: { withUserId: string }): void {
    if (!payload.withUserId || !this.storage) return

    const peer = this.clients.get(payload.withUserId)
    let peerName = peer?.name
    if (!peerName) {
      const acc = this.storage.getAccountById(payload.withUserId)
      peerName = acc?.name
    }
    if (!peerName) {
      this.send(client.ws, {
        type: WsMessageType.PrivateHistory,
        payload: { withUserId: payload.withUserId, messages: [] },
      })
      return
    }
    const messages = this.storage.loadPrivateMessages(client.name, peerName)
    this.send(client.ws, {
      type: WsMessageType.PrivateHistory,
      payload: { withUserId: payload.withUserId, messages },
    })
  }

  private handleUpdateProfile(client: Client, payload: { name?: string; email?: string; password?: string; avatar?: string }): void {
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
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : client.email
    if (email && !this.isValidEmail(email)) {
      this.send(client.ws, { type: WsMessageType.Error, payload: 'Invalid email' })
      return
    }
    if (this.storage && email && email !== client.email) {
      const owner = this.storage.getAccountByEmail(email)
      if (owner && owner.name !== name) {
        this.send(client.ws, { type: WsMessageType.Error, payload: 'Email in use' })
        return
      }
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
    client.email = email || undefined
    if (payload.avatar !== undefined) {
      client.avatar = payload.avatar || undefined
    }

    if (this.storage) {
      const id = client.id
      if (name !== oldName) {
        this.storage.renameAccount(oldName, { name, id, email: client.email, password, avatar: client.avatar, isAdmin: client.admin, tags: client.tags })
      } else {
        this.storage.saveAccount({ name, id, email: client.email, password, avatar: client.avatar, isAdmin: client.admin, tags: client.tags })
      }
    }

    this.send(client.ws, {
      type: WsMessageType.ProfileUpdated,
      payload: { id: client.id, name, email: client.email, avatar: client.avatar },
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
        payload: { userId: liveBroadcast.userId, userName: liveBroadcast.userName, mime: liveBroadcast.mime },
      })
      // Avisa o transmissor para criar um RTCPeerConnection com o novo espectador.
      if (liveBroadcast.userId !== client.id) {
        const broadcaster = this.clients.get(liveBroadcast.userId)
        if (broadcaster) {
          this.send(broadcaster.ws, {
            type: WsMessageType.LivePeerJoined,
            payload: { peerUserId: client.id, peerName: client.name },
          })
        }
      }
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

  // Sinalização WebRTC: apenas encaminha offer/answer/ICE entre os pares.
  private handleRTCSignal(client: Client, payload: { toUserId: string; sdp?: unknown; candidate?: unknown }): void {
    if (!payload.toUserId) return
    const target = this.clients.get(payload.toUserId)
    if (!target) return
    this.send(target.ws, {
      type: WsMessageType.RTCSignal,
      payload: {
        fromUserId: client.id,
        fromUserName: client.name,
        sdp: payload.sdp,
        candidate: payload.candidate,
      },
    })
  }

  // Preview de live no popup de informações: pede ao transmissor para criar um
  // RTCPeerConnection extra para o solicitante (mesmo fora da sala da live).
  private handleRequestLivePreview(client: Client, payload: { broadcasterUserId: string }): void {
    if (!payload.broadcasterUserId) return
    const broadcaster = this.clients.get(payload.broadcasterUserId)
    if (!broadcaster) return
    this.send(broadcaster.ws, {
      type: WsMessageType.LivePeerJoined,
      payload: { peerUserId: client.id, peerName: client.name, preview: true },
    })
  }

  private handleLiveStart(client: Client, payload: { mime?: string } = {}): void {
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

    const mime = typeof payload.mime === 'string' && payload.mime ? payload.mime : undefined
    this.rooms.setLiveBroadcast(roomId, { userId: client.id, userName: client.name, timestamp: Date.now(), initChunk: undefined, mime })
    this.broadcastToRoom(roomId, {
      type: WsMessageType.LiveStarted,
      payload: { userId: client.id, userName: client.name, mime },
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

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }

  private toUserPayload(client: Client): { id: string; name: string; room: string | null; admin: boolean; avatar?: string; tags?: string[] } {
    return {
      id: client.id,
      name: client.name,
      room: client.room,
      admin: client.admin,
      avatar: client.avatar,
      tags: client.tags,
    }
  }
}
