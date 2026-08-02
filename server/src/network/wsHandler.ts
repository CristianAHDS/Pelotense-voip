import { WebSocketServer, WebSocket } from 'ws'
import { Client, ChatMessage, WsMessage, WsMessageType, LiveState, SecurityLimits, DEFAULT_SECURITY_LIMITS } from '../types/index.js'
import { ClientManager } from '../clients/index.js'
import { RoomManager } from '../rooms/index.js'
import { logger } from '../utils/logger.js'
import { eventBus } from '../utils/events.js'
import { EventType } from '../types/index.js'
import { SqliteStore } from '../storage/index.js'
import { config } from '../config/index.js'
import Database from 'better-sqlite3'
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const MASTER_USER_ID = process.env.MASTER_USER_ID || 'fc2su3qi'
const MASTER_NAME = process.env.MASTER_NAME || 'Cris'
const MASTER_EMAIL = process.env.MASTER_EMAIL || 'admin@ahoradosul.com.br'
const RADIO_ROOM_NAME = process.env.RADIO_ROOM_NAME || 'Retorno ao vivo'

// Sempre master: pelo id configurado OU pelo nome OU pelo e-mail.
function isMaster(u: { id?: string; name: string; email?: string }): boolean {
  return u.id === MASTER_USER_ID
    || u.name === MASTER_NAME
    || (!!u.email && u.email.toLowerCase() === MASTER_EMAIL.toLowerCase())
}

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

  // Estado de gestão do sistema (painel admin)
  private maintenanceMode = false
  private maintenanceMessage = ''
  private guestMode = false
  private readonly adminLog: Array<{ at: number; by: string; action: string; detail?: string }> = []
  private readonly startedAt = Date.now()

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
            this.handleLogin(ws, msg.payload as { name: string; email?: string; password: string; avatar?: string; deviceId?: string })
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

  private handleLogin(ws: WebSocket, payload: { name: string; email?: string; password: string; avatar?: string; intent?: string; deviceId?: string }): void {
    const pending = this.pendingClients.get(ws)
    if (!pending) return

    const { name, password, avatar } = payload
    const intent = typeof payload.intent === 'string' ? payload.intent : ''
    const isGuestIntent = intent === 'guest'
    // Convidados entram sem nome e sem senha (o servidor gera "guest###").
    if ((!name && !isGuestIntent) || (!password && !isGuestIntent)) {
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

    // Modo manutenção: bloqueia novos logins (admin continua podendo entrar).
    if (this.maintenanceMode && !isMaster({ name, email }) && !this.adminNames.includes(name)) {
      this.send(ws, { type: WsMessageType.Error, payload: { code: 'maintenance', message: this.maintenanceMessage || 'Manutenção em andamento. Tente novamente mais tarde.' } })
      ws.close()
      return
    }

    // Usuário banido?
    if (this.storage) {
      const ban = this.storage.isBanned(identifier) || (email ? this.storage.isBanned(email) : undefined)
      if (ban) {
        this.send(ws, { type: WsMessageType.Error, payload: { code: 'banned', message: ban.reason ? `Banido: ${ban.reason}` : 'Você foi banido' } })
        ws.close()
        return
      }
    }

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

    if (intent === 'guest') {
      // Modo convidado: entra sem senha/`conta`, com restrições.
      if (!this.guestMode) {
        this.send(ws, { type: WsMessageType.Error, payload: { code: 'guest_disabled', message: 'Modo convidado desativado' } })
        ws.close()
        return
      }
      if (account && account.password) {
        this.send(ws, { type: WsMessageType.Error, payload: { code: 'guest_account', message: 'Esta conta tem senha — use o login normal' } })
        ws.close()
        return
      }
      // Sem nome digitado (ou com mais de um convidado online / nome em uso),
      // gera "guest" + id curto de 3 dígitos para cada um.
      let guestName = identifier
      const needsGenerated = !guestName
        || this.clients.findByName(guestName) !== undefined
        || this.clients.getAll().some((c) => c.isGuest)
      if (needsGenerated) guestName = this.generateGuestName()
      account = { name: guestName, id: this.generateId(), password: '', emailConfirmed: true, createdAt: Date.now() }
    } else if (intent === 'register') {
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
      admin: isMaster(account) || this.adminNames.includes(resolvedName) || this.adminIds.includes(id) || account.isAdmin === true,
      avatar: avatar ?? account.avatar,
      email: account.email,
      tags: account.tags,
      isGuest: isGuestIntent,
      ws,
    }

    if (!this.clients.add(client)) {
      this.send(ws, { type: WsMessageType.Error, payload: 'Server full' })
      ws.close()
      return
    }

    // Convidados são efêmeros: não criam conta persistida.
    if (!isGuestIntent && this.storage) {
      this.storage.saveAccount({ name: client.name, id: client.id, email: client.email, password: client.password, avatar: client.avatar })
    }

    this.pendingClients.delete(ws)
    ws.removeAllListeners('message')

    // Onboarding por dispositivo: na primeira vez que este aparelho entra no
    // sistema, o Welcome sinaliza onboarding para o cliente mostrar o tour.
    const deviceId = typeof payload.deviceId === 'string' && payload.deviceId ? payload.deviceId : ''
    let onboarding = false
    if (deviceId && this.storage) {
      const dev = this.storage.getDevice(deviceId)
      if (!dev || !dev.onboarding) {
        onboarding = true
        this.storage.saveDevice({ id: deviceId, userName: client.name, onboarding: false })
      } else {
        this.storage.saveDevice({ id: deviceId, userName: client.name, onboarding: true })
      }
    }

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
      payload: { id: client.id, name: client.name, udpPort: this.udpPort, admin: client.admin, avatar: client.avatar, email: client.email, maintenance: this.maintenanceMode, maintenanceMessage: this.maintenanceMessage, onboarding, guest: client.isGuest },
    })

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
        this.handleChatMessage(client, msg.payload as { text: string; id?: string })
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

      case WsMessageType.AdminCmd:
        this.handleAdminCmd(client, msg.payload as { cmd: string; [k: string]: unknown })
        break

      case WsMessageType.OnboardingComplete:
        this.handleOnboardingComplete(client, msg.payload as { deviceId?: string })
        break

      default:
        logger.warn('WsHandler', `Unknown message type: ${msg.type}`)
    }
  }

  private handleOnboardingComplete(client: Client, payload: { deviceId?: string }): void {
    if (!this.storage) return
    const deviceId = typeof payload.deviceId === 'string' && payload.deviceId ? payload.deviceId : ''
    if (deviceId) this.storage.setDeviceOnboarding(deviceId, true)
  }

  private adminResult(ws: WebSocket, cmd: string, ok: boolean, data?: unknown, error?: string): void {
    this.send(ws, { type: WsMessageType.AdminResult, payload: { cmd, ok, data, error } })
  }

  private adminLogAdd(by: string, action: string, detail?: string): void {
    this.adminLog.unshift({ at: Date.now(), by, action, detail })
    if (this.adminLog.length > 200) this.adminLog.length = 200
  }

  private handleAdminCmd(client: Client, payload: { cmd: string; [k: string]: unknown }): void {
    if (!client.admin) {
      this.adminResult(client.ws, String(payload.cmd ?? ''), false, undefined, 'Not allowed')
      return
    }
    const cmd = String(payload.cmd ?? '')

    switch (cmd) {
      case 'metrics': {
        const online = this.clients.size()
        const rooms = this.rooms.getAll()
        const live = rooms.filter((r) => this.rooms.getLiveBroadcast(r.id)).length
        const stats = this.storage?.getStats()
        const mem = process.memoryUsage()
        this.adminResult(client.ws, cmd, true, {
          usersOnline: online,
          maxUsers: this.clients.getMaxUsers(),
          rooms: rooms.length,
          maxRooms: this.rooms.getMaxRooms(),
          liveCount: live,
          accounts: stats?.accounts ?? 0,
          devices: this.storage?.countDevices() ?? 0,
          messages: stats?.messages ?? 0,
          privateMessages: stats?.privateMessages ?? 0,
          messagesToday: stats?.messagesToday ?? 0,
          privateToday: stats?.privateToday ?? 0,
          uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
          memoryMB: Math.round(mem.rss / 1024 / 1024),
          heapMB: Math.round(mem.heapUsed / 1024 / 1024),
          maintenance: this.maintenanceMode,
          guestMode: this.guestMode,
        })
        break
      }

      case 'diagnostics': {
        const mem = process.memoryUsage()
        this.adminResult(client.ws, cmd, true, {
          uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
          memoryMB: Math.round(mem.rss / 1024 / 1024),
          heapMB: Math.round(mem.heapUsed / 1024 / 1024),
          clients: this.clients.size(),
          rooms: this.rooms.getAll().length,
          liveCount: this.rooms.getAll().filter((r) => this.rooms.getLiveBroadcast(r.id)).length,
          pendingConnections: this.pendingClients.size,
          maintenance: this.maintenanceMode,
          guestMode: this.guestMode,
        })
        break
      }

      case 'guest': {
        this.guestMode = payload.enabled === true
        this.adminLogAdd(client.name, 'guest', String(this.guestMode))
        this.clients.getAll().forEach((c) => {
          this.send(c.ws, { type: WsMessageType.GuestState, payload: { enabled: this.guestMode } })
        })
        this.adminResult(client.ws, cmd, true, { enabled: this.guestMode })
        break
      }

      case 'onboarding_reset': {
        const name = String(payload.name ?? '').trim()
        if (!name) {
          this.adminResult(client.ws, cmd, false, undefined, 'Informe o usuário')
          break
        }
        const n = this.storage?.resetUserOnboarding(name) ?? 0
        this.adminLogAdd(client.name, 'onboarding_reset', `${name} (${n} dispositivos)`)
        this.adminResult(client.ws, cmd, true, { reset: n })
        break
      }

      case 'rooms':
        this.adminResult(client.ws, cmd, true, this.rooms.listRoomsDetailed())
        break

      case 'room_action': {
        const roomId = String(payload.roomId ?? '')
        const action = String(payload.action ?? '')
        const room = this.rooms.get(roomId)
        if (!room) {
          this.adminResult(client.ws, cmd, false, undefined, 'Room not found')
          break
        }
        let detail = ''
        if (action === 'rename') {
          const newName = String(payload.value ?? '').trim()
          if (!newName || newName.length > this.limits.maxRoomNameLength) {
            this.adminResult(client.ws, cmd, false, undefined, 'Invalid name')
            break
          }
          if (!this.rooms.rename(roomId, newName)) {
            this.adminResult(client.ws, cmd, false, undefined, 'Name in use')
            break
          }
          detail = `renomeada para ${newName}`
        } else if (action === 'fixed') {
          this.rooms.setFixed(roomId, payload.value === true)
          detail = `fixed=${payload.value === true}`
        } else if (action === 'featured') {
          const v = payload.value === null ? undefined : Number(payload.value)
          const f = v !== undefined && Number.isFinite(v) ? v : undefined
          this.rooms.setFeatured(roomId, f)
          detail = `featured=${f ?? 'nenhum'}`
        } else if (action === 'clear') {
          const n = this.rooms.clearMessages(roomId)
          detail = `${n} mensagens apagadas`
          this.broadcastToRoom(roomId, { type: WsMessageType.RoomDeleted, payload: { roomId } }, '')
        } else if (action === 'delete') {
          if (room.fixed) {
            this.adminResult(client.ws, cmd, false, undefined, 'Fixed room cannot be deleted')
            break
          }
          this.handleDeleteRoom(client, roomId)
          this.adminLogAdd(client.name, 'delete_room', room.name)
          this.adminResult(client.ws, cmd, true, this.rooms.listRoomsDetailed(), undefined)
          break
        } else {
          this.adminResult(client.ws, cmd, false, undefined, 'Unknown action')
          break
        }
        this.broadcast({ type: WsMessageType.RoomList, payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)) })
        this.adminLogAdd(client.name, `room_${action}`, room.name + (detail ? ` — ${detail}` : ''))
        this.adminResult(client.ws, cmd, true, this.rooms.listRoomsDetailed(), undefined)
        break
      }

      case 'ban': {
        const name = typeof payload.name === 'string' ? payload.name.trim() : ''
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
        const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
        if (!name && !email) {
          this.adminResult(client.ws, cmd, false, undefined, 'Informe nome ou e-mail')
          break
        }
        this.storage?.addBan({ name: name || undefined, email: email || undefined, reason: reason || undefined, date: Date.now() })
        // Expulsa online
        const target = name ? this.clients.findByName(name) : this.clients.getAll().find((c) => c.email === email)
        if (target) this.kickClient(target, `Banido${reason ? `: ${reason}` : ''}`)
        this.adminLogAdd(client.name, 'ban', name || email)
        this.adminResult(client.ws, cmd, true, this.storage?.getBans() ?? [])
        break
      }

      case 'unban': {
        const key = String(payload.value ?? '').trim()
        this.storage?.removeBan(key)
        this.adminLogAdd(client.name, 'unban', key)
        this.adminResult(client.ws, cmd, true, this.storage?.getBans() ?? [])
        break
      }

      case 'banned':
        this.adminResult(client.ws, cmd, true, this.storage?.getBans() ?? [])
        break

      case 'kick': {
        const userId = typeof payload.userId === 'string' ? payload.userId : ''
        const name = typeof payload.name === 'string' ? payload.name : ''
        const target = userId ? this.clients.get(userId) : name ? this.clients.findByName(name) : undefined
        if (!target) {
          this.adminResult(client.ws, cmd, false, undefined, 'Usuário não está online')
          break
        }
        this.kickClient(target, 'Desconectado pelo administrador')
        this.adminLogAdd(client.name, 'kick', target.name)
        this.adminResult(client.ws, cmd, true)
        break
      }

      case 'restrictions': {
        const userId = typeof payload.userId === 'string' ? payload.userId : ''
        const name = typeof payload.name === 'string' ? payload.name : ''
        const target = userId ? this.clients.get(userId) : name ? this.clients.findByName(name) : undefined
        if (!target) {
          this.adminResult(client.ws, cmd, false, undefined, 'Usuário não está online')
          break
        }
        target.restrictions = {
          mic: typeof payload.mic === 'boolean' ? payload.mic : target.restrictions?.mic,
          chat: typeof payload.chat === 'boolean' ? payload.chat : target.restrictions?.chat,
        }
        if (target.restrictions.chat) this.send(target.ws, { type: WsMessageType.Error, payload: 'Você foi silenciado pelo administrador' })
        this.adminLogAdd(client.name, 'restrictions', `${target.name} mic=${target.restrictions.mic} chat=${target.restrictions.chat}`)
        this.adminResult(client.ws, cmd, true, { id: target.id, name: target.name, restrictions: target.restrictions })
        break
      }

      case 'limit': {
        const key = String(payload.key ?? '')
        const value = Number(payload.value)
        if (!Number.isFinite(value) || value < 1) {
          this.adminResult(client.ws, cmd, false, undefined, 'Valor inválido')
          break
        }
        const n = Math.floor(value)
        if (key === 'maxUsers') {
          this.clients.setMaxUsers(n)
        } else if (key === 'maxRooms') {
          this.rooms.setMaxRooms(n)
        } else if (key in this.limits) {
          ;(this.limits as unknown as Record<string, number>)[key] = n
        } else {
          this.adminResult(client.ws, cmd, false, undefined, 'Chave desconhecida')
          break
        }
        this.adminLogAdd(client.name, 'limit', `${key}=${n}`)
        this.adminResult(client.ws, cmd, true, this.getLimitsSnapshot())
        break
      }

      case 'limits':
        this.adminResult(client.ws, cmd, true, this.getLimitsSnapshot())
        break

      case 'announce': {
        const text = String(payload.text ?? '').trim().slice(0, this.limits.maxTextLength)
        if (!text) {
          this.adminResult(client.ws, cmd, false, undefined, 'Texto vazio')
          break
        }
        // Banner global: aparece na tela de TODOS os conectados no momento,
        // com timer. Não entra no histórico dos chats de sala.
        const id = this.generateMessageId()
        const durationMs = Math.max(3000, Math.min(60000, Number(payload.durationMs) || 15000))
        this.clients.getAll().forEach((c) => {
          this.send(c.ws, { type: WsMessageType.GlobalAnnouncement, payload: { id, text, durationMs } })
        })
        this.adminLogAdd(client.name, 'announce', text)
        this.adminResult(client.ws, cmd, true)
        break
      }

      case 'maintenance': {
        this.maintenanceMode = payload.enabled === true
        this.maintenanceMessage = typeof payload.message === 'string' ? payload.message.slice(0, 200) : ''
        this.adminLogAdd(client.name, 'maintenance', String(this.maintenanceMode) + (this.maintenanceMessage ? ` — ${this.maintenanceMessage}` : ''))
        // Avisa todos os conectados (inclusive o admin que ativou).
        this.clients.getAll().forEach((c) => {
          this.send(c.ws, {
            type: WsMessageType.MaintenanceState,
            payload: { enabled: this.maintenanceMode, message: this.maintenanceMessage },
          })
        })
        this.adminResult(client.ws, cmd, true, { enabled: this.maintenanceMode, message: this.maintenanceMessage })
        break
      }

      case 'backup': {
        if (!this.storage) {
          this.adminResult(client.ws, cmd, false, undefined, 'Storage unavailable')
          break
        }
        try {
          const dest = join(tmpdir(), `voip-backup-${Date.now()}.db`)
          this.storage.backupTo(dest).then(() => {
            const buf = readFileSync(dest)
            try { unlinkSync(dest) } catch { /* ignore */ }
            if (buf.length > this.limits.maxVideoMessageBytes * 12) {
              this.adminResult(client.ws, cmd, false, undefined, 'Backup muito grande para enviar pelo socket')
              return
            }
            this.adminResult(client.ws, cmd, true, { base64: buf.toString('base64'), size: buf.length, date: Date.now() })
          }).catch((e) => {
            logger.error('WsHandler', 'Backup failed', e)
            this.adminResult(client.ws, cmd, false, undefined, 'Falha no backup')
          })
        } catch (e) {
          this.adminResult(client.ws, cmd, false, undefined, 'Falha no backup')
        }
        break
      }

      case 'restore': {
        const base64 = typeof payload.base64 === 'string' ? payload.base64 : ''
        if (!base64) {
          this.adminResult(client.ws, cmd, false, undefined, 'Payload vazio')
          break
        }
        const buf = Buffer.from(base64, 'base64')
        if (buf.length < 100 || buf.length > 64 * 1024 * 1024) {
          this.adminResult(client.ws, cmd, false, undefined, 'Arquivo inválido ou grande demais')
          break
        }
        const tmp = join(tmpdir(), `voip-restore-${Date.now()}.db`)
        writeFileSync(tmp, buf)
        try {
          const check = new Database(tmp, { readonly: true })
          check.prepare('SELECT COUNT(*) AS n FROM accounts').get()
          check.close()
        } catch {
          try { unlinkSync(tmp) } catch { /* ignore */ }
          this.adminResult(client.ws, cmd, false, undefined, 'Arquivo de backup inválido')
          break
        }
        this.storage?.close()
        this.storage = new SqliteStore(tmp)
        this.rooms.setStorage(this.storage)
        try { copyFileSync(tmp, config.dbPath) } catch { /* ignore */ }
        this.adminLogAdd(client.name, 'restore', 'banco restaurado')
        this.adminResult(client.ws, cmd, true, { note: 'Banco restaurado' })
        break
      }

      case 'cleanup': {
        if (!this.storage) {
          this.adminResult(client.ws, cmd, false, undefined, 'Storage unavailable')
          break
        }
        const stats = this.storage.getStats()
        const emptyRooms = this.rooms.getAll().filter((r) => !r.fixed && r.clients.size === 0)
        this.adminResult(client.ws, cmd, true, {
          messages: stats.messages,
          privateMessages: stats.privateMessages,
          accounts: stats.accounts,
          emptyRooms: emptyRooms.map((r) => r.name),
        })
        break
      }

      case 'cleanup_apply': {
        if (!this.storage) {
          this.adminResult(client.ws, cmd, false, undefined, 'Storage unavailable')
          break
        }
        const days = Math.max(1, Math.min(365, Number(payload.days) || 30))
        const removeEmptyRooms = payload.emptyRooms === true
        const del = this.storage.deleteMessagesOlderThan(days)
        let roomsRemoved = 0
        if (removeEmptyRooms) {
          for (const r of this.rooms.getAll()) {
            if (!r.fixed && r.clients.size === 0 && this.rooms.delete(r.id)) roomsRemoved++
          }
        }
        this.adminLogAdd(client.name, 'cleanup', `${del.roomMessages} msgs sala, ${del.privateMessages} msgs privadas, ${roomsRemoved} salas vazias`)
        this.adminResult(client.ws, cmd, true, { ...del, roomsRemoved })
        break
      }

      case 'log':
        this.adminResult(client.ws, cmd, true, this.adminLog)
        break

      case 'radio': {
        const action = String(payload.action ?? '')
        if (action !== 'pause' && action !== 'play') {
          this.adminResult(client.ws, cmd, false, undefined, 'Ação inválida')
          break
        }
        // Avisa todos os clientes que estão na sala emissora.
        const radioRoom = this.rooms.findByName(RADIO_ROOM_NAME)
        const targets = radioRoom ? Array.from(radioRoom.clients.values()) : this.clients.getAll()
        targets.forEach((c) => this.send(c.ws, { type: WsMessageType.RadioControl, payload: { action } }))
        this.adminLogAdd(client.name, 'radio', action)
        this.adminResult(client.ws, cmd, true)
        break
      }

      default:
        this.adminResult(client.ws, cmd, false, undefined, 'Comando desconhecido')
    }
  }

  private generateGuestName(): string {
    for (let i = 0; i < 200; i++) {
      const suffix = Math.floor(100 + Math.random() * 900)
      const name = `guest${suffix}`
      if (!this.clients.findByName(name)) return name
    }
    return 'guest' + Date.now().toString().slice(-3)
  }

  private getLimitsSnapshot(): Record<string, number> {
    return {
      maxUsers: this.clients.getMaxUsers(),
      maxRooms: this.rooms.getMaxRooms(),
      maxNameLength: this.limits.maxNameLength,
      maxPasswordLength: this.limits.maxPasswordLength,
      maxRoomNameLength: this.limits.maxRoomNameLength,
      maxTextLength: this.limits.maxTextLength,
      maxAudioMessageBytes: this.limits.maxAudioMessageBytes,
      maxVideoMessageBytes: this.limits.maxVideoMessageBytes,
      maxImageMessageBytes: this.limits.maxImageMessageBytes,
      maxLiveChunkBytes: this.limits.maxLiveChunkBytes,
      maxVoiceFrameBytes: this.limits.maxVoiceFrameBytes,
      maxAvatarBytes: this.limits.maxAvatarBytes,
    }
  }

  private kickClient(target: Client, message: string): void {
    try {
      this.send(target.ws, { type: WsMessageType.Error, payload: message })
      target.ws.close()
    } catch { /* ignore */ }
    // Remove da sessão, se estiver em uma sala.
    if (target.room) this.rooms.leave(target.room, target)
    this.clients.remove(target.id)
    this.broadcast({ type: WsMessageType.UserList, payload: this.clients.getAll().map((c) => this.toUserPayload(c)) })
    this.broadcast({ type: WsMessageType.RoomList, payload: this.rooms.getAll().map((r) => this.rooms.toRoomListPayload(r)) })
  }

  private handleChatMessage(client: Client, payload: { text: string; id?: string }): void {
    if (!client.room || !payload.text?.trim()) return
    if (client.isGuest) return
    if (client.restrictions?.chat) return
    if (payload.text.length > this.limits.maxTextLength) {
      logger.warn('WsHandler', `Chat message from ${client.id} exceeds ${this.limits.maxTextLength} chars, dropped`)
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
      text: payload.text.trim(),
      timestamp: Date.now(),
    }

    this.rooms.addMessage(room.id, chatMsg)

    this.broadcastToRoom(client.room, {
      type: WsMessageType.ChatMessage,
      payload: chatMsg,
    }, '')
  }

  private handleChatAudioMessage(client: Client, payload: { id?: string; audioData: string; duration: number; mime?: string }): void {
    if (!client.room || !payload.audioData) return
    if (client.restrictions?.chat) return
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
      mime: typeof payload.mime === 'string' ? payload.mime : undefined,
      timestamp: Date.now(),
    }

    this.rooms.addMessage(room.id, chatMsg)

    this.broadcastToRoom(client.room, {
      type: WsMessageType.ChatAudioMessage,
      payload: chatMsg,
    }, '')
  }

  private handleChatVideoMessage(client: Client, payload: { id?: string; videoData: string; duration: number; mime?: string }): void {
    if (!client.room || !payload.videoData) return
    if (client.restrictions?.chat) return
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
      mime: typeof payload.mime === 'string' ? payload.mime : undefined,
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
    if (client.isGuest) return
    if (client.restrictions?.chat) return
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
    // Mic silenciado pelo admin: descarta os frames de voz.
    if (client.restrictions?.mic) return
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
    if (client.isGuest) return
    if (client.restrictions?.chat) return
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

  private handlePrivateAudioMessage(client: Client, payload: { toUserId: string; id?: string; audioData: string; duration: number; mime?: string }): void {
    if (!payload.toUserId || !payload.audioData) return
    if (client.isGuest) return
    if (client.restrictions?.chat) return
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
        mime: typeof payload.mime === 'string' ? payload.mime : undefined,
        timestamp: Date.now(),
      },
    }

    this.storage?.savePrivateMessage(msg.payload)

    if (resolved.ws) this.send(resolved.ws, msg)
    this.send(client.ws, msg)
  }

  private handlePrivateVideoMessage(client: Client, payload: { toUserId: string; id?: string; videoData: string; duration: number; mime?: string }): void {
    if (!payload.toUserId || !payload.videoData) return
    if (client.isGuest) return
    if (client.restrictions?.chat) return
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
        mime: typeof payload.mime === 'string' ? payload.mime : undefined,
        timestamp: Date.now(),
      },
    }

    this.storage?.savePrivateMessage(msg.payload)

    if (resolved.ws) this.send(resolved.ws, msg)
    this.send(client.ws, msg)
  }

  private handlePrivateImageMessage(client: Client, payload: { toUserId: string; id?: string; imageData: string }): void {
    if (!payload.toUserId || !payload.imageData) return
    if (client.isGuest) return
    if (client.restrictions?.chat) return
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

  private isAccountAdmin(a: { id?: string; name: string; email?: string; isAdmin?: boolean }): boolean {
    return isMaster(a)
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
    if (isMaster(target) && !isAdmin) {
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
