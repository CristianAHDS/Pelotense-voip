import { WsClient } from '../network/wsClient.ts'
import { WsMessageType, LoginPayload, WelcomePayload, ChatMsg, PrivateChatMsg, AdminResult, SystemSettings } from '../types/index.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useAccountStore } from '../stores/accountStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { VoiceManager } from '../voice/index.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { useToastStore } from '../stores/toastStore.ts'
import { useAdminStore } from '../stores/adminStore.ts'
import { useAnnouncementStore } from '../stores/announcementStore.ts'
import { useOnboardingStore } from '../stores/onboardingStore.ts'
import { getDeviceId } from '../utils/device.ts'
import { radioPlayer } from './radioStream.ts'
import { notifyNewMessage, requestNotificationPermission, notifyMention } from './notifications.ts'
import { chatHistory } from './historyStore.ts'
import * as liveRtc from './liveRtc.ts'
import { tStatic } from '../i18n/index.ts'

let wsClient: WsClient | null = null
let reconnecting: boolean = false
let intentionalDisconnect: boolean = false
let voiceManager: VoiceManager | null = null
let voiceCleanup: (() => void) | null = null
// Só reconecta automaticamente se já tiver logado (recebido Welcome). Se o
// login falhou (senha errada, conta inexistente etc.), para de tentar.
let hasReceivedWelcome: boolean = false

// V2.9 — acompanha mensagens otimistas até o eco do servidor; se demorar,
// marca como falha para o usuário poder reenviar.
const SEND_TIMEOUT_MS = 8000
const pendingSends = new Map<string, ReturnType<typeof setTimeout>>()

// Indicador de digitação: mantém o nome do usuário visível por um tempo após o
// último sinal; o próprio cliente renova o sinal enquanto digita.
const TYPING_VISIBLE_MS = 4000
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleTypingExpiry(userId: string): void {
  const existing = typingTimers.get(userId)
  if (existing) clearTimeout(existing)
  typingTimers.set(userId, setTimeout(() => {
    typingTimers.delete(userId)
    useRoomStore.getState().removeTypingUser(userId)
  }, TYPING_VISIBLE_MS))
}

function clearPending(id: string): void {
  const t = pendingSends.get(id)
  if (t) {
    clearTimeout(t)
    pendingSends.delete(id)
  }
}

function trackSend(id: string): void {
  clearPending(id)
  pendingSends.set(id, setTimeout(() => {
    if (!pendingSends.has(id)) return
    pendingSends.delete(id)
    useRoomStore.getState().markMessageFailed(id)
    usePrivateChatStore.getState().markMessageFailed(id)
  }, SEND_TIMEOUT_MS))
}

function confirmMessage(id: string | undefined): void {
  if (id) clearPending(id)
}

export function getWsClient(): WsClient | null {
  return wsClient
}

export function getVoiceManager(): VoiceManager | null {
  return voiceManager
}

export function sendVoiceData(data: ArrayBuffer): void {
  wsClient?.sendBinary(data)
}

export function sendTyping(isTyping: boolean): void {
  wsClient?.send(WsMessageType.Typing, { isTyping })
}

function initVoice(): void {
  if (voiceManager) return
  voiceManager = new VoiceManager()
  voiceManager.setOnSend((data) => sendVoiceData(data))
  voiceCleanup = wsClient?.onBinary((data) => {
    const userIdBytes = data.slice(0, 8)
    const audioData = data.slice(8)
    const userId = new TextDecoder().decode(userIdBytes).replace(/\0+$/, '')
    if (userId) {
      useVoiceStore.getState().markSpeaking(userId)
    }
    voiceManager?.playAudio(audioData, userId)
  }) ?? null
}

function cleanupVoice(): void {
  voiceManager?.stopMicrophone()
  voiceCleanup?.()
  voiceCleanup = null
  voiceManager?.destroy()
  voiceManager = null
}

function voiceOnLogin(): void {
  // Pede a permissão do microfone logo após o login. No mobile, o gesto de
  // conceder a permissão "destrava" o AudioContext de saída (política de
  // autoplay); sem isso o som só começava a sair após um Unmute/Mute manual.
  // O estado de mudo não é alterado: o envio continua sendo controlado por ele.
  voiceManager?.startMicrophone().then((ok) => {
    if (!ok) useVoiceStore.getState().setMuted(true)
  })
}

function voiceOnRoomJoined(): void {
  // Ao entrar (ou trocar de sala) limpa qualquer áudio agendado da sala anterior.
  voiceManager?.flushAudio()
  const muted = useVoiceStore.getState().muted
  if (!muted) {
    voiceManager?.startMicrophone().then((ok) => {
      if (!ok) useVoiceStore.getState().setMuted(true)
    })
  }
  voiceManager?.resumeOutput()
}

function voiceOnRoomLeft(): void {
  voiceManager?.stopMicrophone()
  voiceManager?.flushAudio()
}

function markRoomUnread(): void {
  const store = useRoomStore.getState()
  if (!store.currentRoom) return
  if (typeof document !== 'undefined' && document.hidden) {
    store.incrementUnread(store.currentRoom)
  }
}

function messageBody(payload: ChatMsg): string {
  if (payload.text) return payload.text
  if (payload.audioData) return tStatic('notifVoiceMsg')
  if (payload.videoData) return tStatic('notifVideoMsg')
  if (payload.imageData) return tStatic('notifImageMsg')
  if (payload.fileData) return `📎 ${payload.fileName ?? tStatic('notifFileMsg')}`
  return tStatic('notifNewMsg')
}

function onRoomChatMessage(payload: ChatMsg): void {
  useRoomStore.getState().addMessage(payload)
  confirmMessage(payload.id)
  const roomId = useRoomStore.getState().currentRoom
  if (roomId) {
    void chatHistory.saveRoomMessages(roomId, useRoomStore.getState().messages)
  }
  markRoomUnread()
  if (typeof document !== 'undefined' && document.hidden) {
    notifyNewMessage(
      `#${useRoomStore.getState().currentRoomName ?? tStatic('roomFallback')}`,
      `${payload.userName}: ${messageBody(payload)}`
    )
  }
  const myName = useConnectionStore.getState().name
  if (myName && payload.text && payload.text.includes(`@${myName}`)) {
    notifyMention(payload.userName, useRoomStore.getState().currentRoomName ?? '', messageBody(payload))
  }
}

function maybeNotifyPrivate(payload: PrivateChatMsg, body: string): void {
  const store = usePrivateChatStore.getState()
  const myId = useConnectionStore.getState().id
  const isIncoming = payload.fromUserId !== myId
  if (!isIncoming) return
  const key = payload.toUserId && payload.fromUserId === myId
    ? payload.toUserId
    : payload.fromUserId
  const isActive = store.activeUserId === key
  const isFocused = typeof document !== 'undefined' && !document.hidden && document.hasFocus()
  if (isActive && isFocused) return
  notifyNewMessage(payload.fromUserName, body)
}

export function connectToServer(address: string, name: string, password: string, email?: string, intent?: 'login' | 'register' | 'guest'): void {
  if (wsClient) disconnectFromServer()

  hasReceivedWelcome = false
  useConnectionStore.getState().setLoginStep('none')

  wsClient = new WsClient()
  reconnecting = false
  initVoice()

  wsClient.setOnLatency((ms) => {
    useConnectionStore.getState().setLatency(ms)
  })

  wsClient.on('connected', () => {
    const avatar = useAccountStore.getState().avatar
    const payload: LoginPayload = { name, password, email: email || undefined, avatar: avatar || undefined, intent, deviceId: getDeviceId() }
    wsClient?.send(WsMessageType.Login, payload)
  })
  wsClient.on('disconnected', () => {
    if (intentionalDisconnect) {
      intentionalDisconnect = false
      return
    }
    // Nunca chegou a logar (senha errada, conta inexistente, servidor cheio,
    // banido/manutenção): para de tentar reconectar e volta ao formulário.
    if (!hasReceivedWelcome) {
      const failed = wsClient
      wsClient = null
      failed?.disconnect()
      reconnecting = false
      useConnectionStore.getState().setDisconnected()
      return
    }
    if (wsClient) {
      reconnecting = true
      useConnectionStore.getState().setReconnecting(true)
    } else {
      useConnectionStore.getState().setDisconnected()
    }
  })

  wsClient.on(WsMessageType.Welcome, (msg) => {
    reconnecting = false
    hasReceivedWelcome = true
    const payload = msg.payload as WelcomePayload
    useConnectionStore.getState().setConnected(payload.id, payload.name, !!payload.admin)
    useConnectionStore.getState().setGuest(!!payload.guest)
    if (payload.guestMode !== undefined) {
      useConnectionStore.getState().setGuestMode(payload.guestMode)
    }
    if (payload.appVersion) {
      useConnectionStore.getState().setServerVersion(payload.appVersion.version, payload.appVersion.build)
    }
    if (payload.settings) {
      useConnectionStore.getState().setSettings(payload.settings)
    }
    if (payload.maintenance !== undefined) {
      useConnectionStore.getState().setMaintenance(payload.maintenance, payload.maintenanceMessage ?? '')
    }
    // Primeira vez deste aparelho no sistema: abre o onboarding.
    if (payload.onboarding) {
      useOnboardingStore.getState().show()
    }
    if (payload.avatar) {
      useAccountStore.getState().setPrefs({ avatar: payload.avatar })
    }
    if (payload.email !== undefined) {
      useAccountStore.getState().setPrefs({ email: payload.email })
    }
    requestRoomList()
    requestAccounts()
    voiceOnLogin()
    requestNotificationPermission()

    // Após uma reconexão o servidor recria o client sem sala (client.room=null);
    // nesse estado o servidor descarta em silêncio texto/áudio/vídeo ("envia mas
    // não aparece", comum no mobile). Re-entra na sala atual para restaurar a
    // participação. No primeiro login currentRoomName é null e nada é feito.
    const currentRoomName = useRoomStore.getState().currentRoomName
    if (currentRoomName) {
      joinRoom(currentRoomName)
    }

    // Reabre o DM que estava ativo antes do refresh/reconexão e pede o
    // histórico persistido no servidor, para as mensagens não "sumirem".
    const activeDm = usePrivateChatStore.getState().activeUserId
    if (activeDm) {
      requestPrivateHistory(activeDm)
    }
  })

  wsClient.on(WsMessageType.RoomList, (msg) => {
    useRoomStore.getState().setRooms(msg.payload as any)
    useRoomStore.getState().setLoadingRooms(false)
  })

  wsClient.on(WsMessageType.UserList, (msg) => {
    useRoomStore.getState().setUsers(msg.payload as any)
    const users = msg.payload as Array<{ id: string; room: string | null }>
    const myId = useConnectionStore.getState().id
    const roomId = useRoomStore.getState().currentRoom
    const viewerIds = users
      .filter((u) => u.id !== myId && u.room === roomId)
      .map((u) => u.id)
    liveRtc.reconcileViewers(viewerIds)
  })

  wsClient.on(WsMessageType.RTCSignal, (msg) => {
    const payload = msg.payload as { fromUserId: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; kind?: 'bc' | 'vw' }
    liveRtc.handleSignal(payload.fromUserId, { sdp: payload.sdp, candidate: payload.candidate, kind: payload.kind })
  })

  wsClient.on(WsMessageType.LivePeerJoined, (msg) => {
    const payload = msg.payload as { peerUserId: string; preview?: boolean }
    if (payload.preview) {
      liveRtc.addPreviewViewer(payload.peerUserId)
    } else {
      liveRtc.addViewer(payload.peerUserId)
    }
  })

  wsClient.on(WsMessageType.AccountsList, (msg) => {
    useRoomStore.getState().setAccounts(msg.payload as any)
  })

  wsClient.on(WsMessageType.RoomJoined, async (msg) => {
    const payload = msg.payload as any
    useRoomStore.getState().setCurrentRoom(payload.roomId, payload.roomName)
    let serverMsgs: ChatMsg[] = payload.messages ?? []
    if (payload.roomId && serverMsgs.length > 0) {
      const local = await chatHistory.loadRoomMessages(payload.roomId)
      if (local && local.length > 0) {
        serverMsgs = serverMsgs.map((srv) => {
          const cached = local.find((c) => c.id && c.id === srv.id)
          if (cached && !cached.filePending && (cached.audioData || cached.videoData || cached.imageData || cached.fileData)) {
            return { ...srv, audioData: cached.audioData, videoData: cached.videoData, imageData: cached.imageData, fileData: cached.fileData, filePending: false }
          }
          return srv
        })
      }
    }
    useRoomStore.getState().setMessages(serverMsgs)
    useRoomStore.getState().setHasMoreMessages(!!payload.hasMore)
    useRoomStore.getState().markRoomRead(payload.roomId)
    useRoomStore.getState().setLoadingMessages(false)
    voiceOnRoomJoined()
    if (payload.roomId && serverMsgs.length > 0) {
      void chatHistory.saveRoomMessages(payload.roomId, serverMsgs)
    }
    if (payload.roomId && serverMsgs.length === 0) {
      const local = await chatHistory.loadRoomMessages(payload.roomId)
      if (local && local.length > 0) {
        useRoomStore.getState().setMessages(local)
      }
    }
  })

  wsClient.on(WsMessageType.RoomLeft, () => {
    useRoomStore.getState().setCurrentRoom(null)
    useRoomStore.getState().clearMessages()
    useRoomStore.getState().setHasMoreMessages(false)
    useRoomStore.getState().setLoadingMore(false)
    useLiveStore.getState().clearBroadcasters()
    voiceOnRoomLeft()
  })

  wsClient.on(WsMessageType.RoomDeleted, (msg) => {
    const payload = msg.payload as any
    const store = useRoomStore.getState()
    if (store.currentRoom === payload.roomId) {
      store.setCurrentRoom(null)
      store.clearMessages()
      voiceOnRoomLeft()
    }
  })

  wsClient.on(WsMessageType.UserJoined, (msg) => {
    const payload = msg.payload as any
    useRoomStore.getState().addUser(payload)
  })

  wsClient.on(WsMessageType.UserLeft, (msg) => {
    const payload = msg.payload as any
    useRoomStore.getState().removeUser(payload.id)
  })

  wsClient.on(WsMessageType.ChatMessage, (msg) => {
    onRoomChatMessage(msg.payload as ChatMsg)
  })

  wsClient.on(WsMessageType.ChatAudioMessage, (msg) => {
    onRoomChatMessage(msg.payload as ChatMsg)
  })

  wsClient.on(WsMessageType.ChatVideoMessage, (msg) => {
    onRoomChatMessage(msg.payload as ChatMsg)
  })

  wsClient.on(WsMessageType.ChatImageMessage, (msg) => {
    onRoomChatMessage(msg.payload as ChatMsg)
  })

  wsClient.on(WsMessageType.ChatFileMessage, (msg) => {
    onRoomChatMessage(msg.payload as ChatMsg)
  })

  wsClient.on(WsMessageType.Typing, (msg) => {
    const payload = msg.payload as { userId: string; userName: string; isTyping: boolean }
    if (!payload.userId || payload.userId === useConnectionStore.getState().id) return
    if (payload.isTyping) {
      useRoomStore.getState().setTypingUser(payload.userId, payload.userName || payload.userId)
      scheduleTypingExpiry(payload.userId)
    } else {
      const t = typingTimers.get(payload.userId)
      if (t) clearTimeout(t)
      typingTimers.delete(payload.userId)
      useRoomStore.getState().removeTypingUser(payload.userId)
    }
  })

  wsClient.on(WsMessageType.MessageReaction, (msg) => {
    // O payload é a própria mensagem atualizada (id igual) — addMessage promove.
    useRoomStore.getState().addMessage(msg.payload as ChatMsg)
  })

  wsClient.on(WsMessageType.MessageDeleted, (msg) => {
    const payload = msg.payload as { messageId: string }
    useRoomStore.getState().removeMessage(payload.messageId)
    const roomId = useRoomStore.getState().currentRoom
    if (roomId) {
      void chatHistory.saveRoomMessages(roomId, useRoomStore.getState().messages)
    }
  })

  wsClient.on(WsMessageType.LiveStarted, (msg) => {
    const payload = msg.payload as { userId: string; userName: string; mime?: string; timestamp?: number }
    useLiveStore.getState().addBroadcaster({ userId: payload.userId, userName: payload.userName, timestamp: payload.timestamp })
    if (payload.userId === useConnectionStore.getState().id) {
      useLiveStore.getState().setMyMime(payload.mime ?? null)
    }
  })

  wsClient.on(WsMessageType.LiveStopped, (msg) => {
    const payload = msg.payload as { userId: string }
    useLiveStore.getState().removeBroadcaster(payload.userId)
    if (payload.userId === useConnectionStore.getState().id) {
      useLiveStore.getState().setMyMime(null)
    }
  })

  wsClient.on(WsMessageType.LiveChunkReceived, (msg) => {
    const payload = msg.payload as { userId: string; chunk: string; duration: number }
    useLiveStore.getState().addChunk({ userId: payload.userId, chunk: payload.chunk, duration: payload.duration })
  })

  wsClient.on(WsMessageType.LiveRequest, (msg) => {
    const payload = msg.payload as { fromUserId: string; fromUserName: string }
    useLiveStore.getState().setPendingRequest(payload)
  })

  wsClient.on(WsMessageType.LiveRequestCancelled, () => {
    useLiveStore.getState().setPendingRequest(null)
  })

  wsClient.on(WsMessageType.LiveRequestResponse, (msg) => {
    const payload = msg.payload as { allow: boolean; fromUserId: string }
    useLiveStore.getState().setTakeoverRequestSent(false)
    if (payload.allow) {
      wsClient?.send(WsMessageType.LiveStart)
    } else {
      useLiveStore.getState().setRequestDenied()
    }
  })

  wsClient.on(WsMessageType.AdminResult, (msg) => {
    const p = msg.payload as AdminResult
    useAdminStore.getState().handleResult(p.cmd, p.ok, p.data, p.error)
  })

  wsClient.on(WsMessageType.RadioControl, (msg) => {
    const p = msg.payload as { action: string }
    if (p.action === 'pause') {
      radioPlayer.pause()
    } else if (p.action === 'play') {
      void radioPlayer.play().catch(() => { /* autoplay pode bloquear */ })
    }
  })

function persistDm(peerUserId: string): void {
  const msgs = usePrivateChatStore.getState().messages[peerUserId] ?? []
  void chatHistory.saveDmMessages(peerUserId, msgs)
}

function dmKey(payload: PrivateChatMsg): string {
  const myId = useConnectionStore.getState().id
  return payload.toUserId && payload.fromUserId === myId
    ? payload.toUserId
    : payload.fromUserId
}

  wsClient.on(WsMessageType.PrivateMessage, (msg) => {
    const payload = msg.payload as PrivateChatMsg
    usePrivateChatStore.getState().addMessage(payload)
    confirmMessage(payload.id)
    persistDm(dmKey(payload))
    maybeNotifyPrivate(payload, payload.text ?? tStatic('notifNewMsg'))
  })

  wsClient.on(WsMessageType.PrivateAudioMessage, (msg) => {
    const payload = msg.payload as PrivateChatMsg
    usePrivateChatStore.getState().addMessage(payload)
    confirmMessage(payload.id)
    persistDm(dmKey(payload))
    maybeNotifyPrivate(payload, tStatic('notifVoiceMsg'))
  })

  wsClient.on(WsMessageType.PrivateVideoMessage, (msg) => {
    const payload = msg.payload as PrivateChatMsg
    usePrivateChatStore.getState().addMessage(payload)
    confirmMessage(payload.id)
    persistDm(dmKey(payload))
    maybeNotifyPrivate(payload, tStatic('notifVideoMsg'))
  })

  wsClient.on(WsMessageType.PrivateImageMessage, (msg) => {
    const payload = msg.payload as PrivateChatMsg
    usePrivateChatStore.getState().addMessage(payload)
    confirmMessage(payload.id)
    persistDm(dmKey(payload))
    maybeNotifyPrivate(payload, tStatic('notifImageMsg'))
  })

  wsClient.on(WsMessageType.PrivateMessageDeleted, (msg) => {
    const payload = msg.payload as { messageId: string }
    const peerId = usePrivateChatStore.getState().activeUserId
    usePrivateChatStore.getState().removeMessage(payload.messageId)
    if (peerId) {
      void chatHistory.saveDmMessages(peerId, usePrivateChatStore.getState().messages[peerId] ?? [])
    }
  })

  wsClient.on(WsMessageType.PrivateHistory, async (msg) => {
    const payload = msg.payload as { withUserId: string; messages: PrivateChatMsg[] }
    const serverMsgs = payload.messages ?? []
    if (serverMsgs.length > 0) {
      usePrivateChatStore.getState().setMessages(payload.withUserId, serverMsgs)
      void chatHistory.saveDmMessages(payload.withUserId, serverMsgs)
    } else {
      const local = await chatHistory.loadDmMessages(payload.withUserId)
      if (local && local.length > 0) {
        usePrivateChatStore.getState().setMessages(payload.withUserId, local)
      }
    }
  })

  wsClient.on(WsMessageType.ProfileUpdated, (msg) => {
    const payload = msg.payload as { id: string; name: string; avatar?: string }
    useConnectionStore.getState().setConnected(payload.id, payload.name, useConnectionStore.getState().admin)
    useAccountStore.getState().setPrefs({ name: payload.name, avatar: payload.avatar ?? '' })
  })

  wsClient.on(WsMessageType.Error, (msg) => {
    const raw = msg.payload as unknown
    let error = tStatic('unknownError')
    let notice = false
    if (raw && typeof raw === 'object' && 'code' in raw && 'message' in raw) {
      const obj = raw as { code: string; message: string }
      error = obj.message
      notice = obj.code === 'maintenance' || obj.code === 'banned'
    } else {
      error = String(raw ?? tStatic('unknownError'))
    }
    useConnectionStore.getState().setDisconnected()
    useToastStore.getState().show(notice ? 'info' : 'error', notice ? error : tStatic('connectionError', { error }))
  })

  wsClient.on(WsMessageType.MaintenanceState, (msg) => {
    const p = msg.payload as { enabled: boolean; message: string }
    useConnectionStore.getState().setMaintenance(p.enabled, p.message)
    useToastStore.getState().show(
      p.enabled ? 'info' : 'success',
      p.enabled
        ? p.message || tStatic('maintenanceOnToast')
        : tStatic('maintenanceOffToast')
    )
  })

  wsClient.on(WsMessageType.GuestState, (msg) => {
    const p = msg.payload as { enabled: boolean }
    useConnectionStore.getState().setGuestMode(p.enabled)
    useToastStore.getState().show(
      p.enabled ? 'info' : 'success',
      p.enabled ? tStatic('guestOnToast') : tStatic('guestOffToast')
    )
  })

  wsClient.on(WsMessageType.SettingsState, (msg) => {
    const p = msg.payload as SystemSettings
    useConnectionStore.getState().setSettings(p)
  })

  wsClient.on(WsMessageType.GlobalAnnouncement, (msg) => {
    const p = msg.payload as { id: string; text: string; durationMs: number }
    useAnnouncementStore.getState().show(p.id, p.text, p.durationMs)
  })

  wsClient.on(WsMessageType.ChatHistoryPage, (msg) => {
    const p = msg.payload as { roomId: string; messages: ChatMsg[]; hasMore: boolean }
    useRoomStore.getState().prependMessages(p.messages)
    useRoomStore.getState().setHasMoreMessages(p.hasMore)
    useRoomStore.getState().setLoadingMore(false)
  })

  wsClient.on(WsMessageType.FileDataResult, (msg) => {
    const p = msg.payload as ChatMsg
    useRoomStore.getState().updateMessage(p)
    const roomId = useRoomStore.getState().currentRoom
    if (roomId) {
      void chatHistory.saveRoomMessages(roomId, useRoomStore.getState().messages)
    }
  })

  wsClient.connect(address)
}

export function joinRoom(roomName: string): void {
  if (!wsClient) { console.error('joinRoom: wsClient is null'); return }
  voiceManager?.resumeOutput()
  useRoomStore.getState().setLoadingMessages(true)
  wsClient.send(WsMessageType.JoinRoom, roomName)
}

export function requestChatHistoryPage(roomId: string): void {
  if (!wsClient) return
  const messages = useRoomStore.getState().messages
  if (messages.length === 0) return
  useRoomStore.getState().setLoadingMore(true)
  const oldest = messages[0]
  wsClient.send(WsMessageType.ChatHistoryPage, { roomId, before: oldest.timestamp ?? (oldest as any).time ?? 0 })
}

export function fetchMessageFileData(roomId: string, messageId: string): void {
  wsClient?.send(WsMessageType.FetchFileData, { roomId, messageId })
}

export function leaveRoom(): void {
  if (!wsClient) { console.error('leaveRoom: wsClient is null'); return }
  wsClient.send(WsMessageType.LeaveRoom)
}

export function createRoom(roomName: string): void {
  if (!wsClient) { console.error('createRoom: wsClient is null'); return }
  wsClient.send(WsMessageType.CreateRoom, roomName)
}

export function deleteRoom(roomId: string): void {
  if (!wsClient) { console.error('deleteRoom: wsClient is null'); return }
  wsClient.send(WsMessageType.DeleteRoom, roomId)
}

export function sendChatMessage(text: string, id?: string): void {
  if (!wsClient) { console.error('sendChatMessage: wsClient is null'); return }
  // Mensagem otimista: aparece na hora como "enviando…", confirmada pelo eco.
  const messageId = id ?? generateClientMessageId()
  const myId = useConnectionStore.getState().id
  const myName = useConnectionStore.getState().name
  useRoomStore.getState().addMessage({
    id: messageId,
    userId: myId ?? '',
    userName: myName ?? '',
    text,
    timestamp: Date.now(),
    sending: true,
  })
  wsClient.send(WsMessageType.ChatMessage, { text, id: messageId })
  trackSend(messageId)
}

export function generateClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
}

export function sendChatAudioMessage(id: string, audioData: string, duration: number, mime?: string): void {
  if (!wsClient) { console.error('sendChatAudioMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.ChatAudioMessage, { id, audioData, duration, mime: mime || undefined })
  trackSend(id)
}

export function sendChatVideoMessage(id: string, videoData: string, duration: number, mime?: string): void {
  if (!wsClient) { console.error('sendChatVideoMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.ChatVideoMessage, { id, videoData, duration, mime: mime || undefined })
  trackSend(id)
}

export function sendChatImageMessage(id: string, imageData: string): void {
  if (!wsClient) { console.error('sendChatImageMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.ChatImageMessage, { id, imageData })
  trackSend(id)
}

export function sendChatFileMessage(id: string, fileData: string, fileName: string, fileSize: number): void {
  if (!wsClient) return
  wsClient.send(WsMessageType.ChatFileMessage, { id, fileData, fileName, fileSize })
  trackSend(id)
}

export function sendMessageReaction(messageId: string, emoji: string): void {
  if (!wsClient) { console.error('sendMessageReaction: wsClient is null'); return }
  wsClient.send(WsMessageType.MessageReaction, { messageId, emoji })
}

export function sendForwardMessage(messageId: string, roomName: string): void {
  if (!wsClient) { console.error('sendForwardMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.ForwardMessage, { messageId, roomName })
}

export function deleteMessage(messageId: string): void {
  if (!wsClient) { console.error('deleteMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.DeleteMessage, { messageId })
}

export function sendPrivateMessage(toUserId: string, text: string, id?: string): void {
  if (!wsClient) { console.error('sendPrivateMessage: wsClient is null'); return }
  const messageId = id ?? generateClientMessageId()
  wsClient.send(WsMessageType.PrivateMessage, { toUserId, text, id: messageId })
  trackSend(messageId)
}

export function sendPrivateAudioMessage(toUserId: string, id: string, audioData: string, duration: number, mime?: string): void {
  if (!wsClient) { console.error('sendPrivateAudioMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.PrivateAudioMessage, { toUserId, id, audioData, duration, mime: mime || undefined })
  trackSend(id)
}

export function sendPrivateVideoMessage(toUserId: string, id: string, videoData: string, duration: number, mime?: string): void {
  if (!wsClient) { console.error('sendPrivateVideoMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.PrivateVideoMessage, { toUserId, id, videoData, duration, mime: mime || undefined })
  trackSend(id)
}

export function sendPrivateImageMessage(toUserId: string, id: string, imageData: string): void {
  if (!wsClient) { console.error('sendPrivateImageMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.PrivateImageMessage, { toUserId, id, imageData })
  trackSend(id)
}

export function resendMessage(messageId: string): void {
  if (!wsClient) { console.error('resendMessage: wsClient is null'); return }
  const msg = useRoomStore.getState().messages.find((m) => m.id === messageId)
  if (!msg) return
  useRoomStore.getState().addMessage({ ...msg, sending: true, failed: false })
  if (msg.text) {
    sendChatMessage(msg.text, messageId)
  } else if (msg.audioData) {
    sendChatAudioMessage(messageId, msg.audioData, msg.duration ?? 0, msg.mime)
  } else if (msg.videoData) {
    sendChatVideoMessage(messageId, msg.videoData, msg.duration ?? 0, msg.mime)
  } else if (msg.imageData) {
    sendChatImageMessage(messageId, msg.imageData)
  }
}

export function resendPrivateMessage(messageId: string): void {
  if (!wsClient) { console.error('resendPrivateMessage: wsClient is null'); return }
  const myId = useConnectionStore.getState().id
  let found: PrivateChatMsg | null = null
  for (const list of Object.values(usePrivateChatStore.getState().messages)) {
    const m = list.find((x) => x.id === messageId)
    if (m) { found = m; break }
  }
  if (!found) return
  const toUserId = found.toUserId && found.fromUserId === myId ? found.toUserId : found.fromUserId
  usePrivateChatStore.getState().addMessage({ ...found, sending: true, failed: false })
  if (found.text) {
    sendPrivateMessage(toUserId, found.text, messageId)
  } else if (found.audioData) {
    sendPrivateAudioMessage(toUserId, messageId, found.audioData, found.duration ?? 0, found.mime)
  } else if (found.videoData) {
    sendPrivateVideoMessage(toUserId, messageId, found.videoData, found.duration ?? 0, found.mime)
  } else if (found.imageData) {
    sendPrivateImageMessage(toUserId, messageId, found.imageData)
  }
}

export function deletePrivateMessage(messageId: string): void {
  if (!wsClient) { console.error('deletePrivateMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.DeletePrivateMessage, { messageId })
}

export function requestPrivateHistory(withUserId: string): void {
  if (!wsClient) { console.error('requestPrivateHistory: wsClient is null'); return }
  wsClient.send(WsMessageType.ListPrivateMessages, { withUserId })
}

export function sendUpdateProfile(profile: { name?: string; email?: string; password?: string; avatar?: string }): void {
  if (!wsClient) { console.error('sendUpdateProfile: wsClient is null'); return }
  wsClient.send(WsMessageType.UpdateProfile, profile)
}

export function sendLiveForceStop(targetUserId: string): void {
  if (!wsClient) { console.error('sendLiveForceStop: wsClient is null'); return }
  wsClient.send(WsMessageType.LiveForceStop, { targetUserId })
}

export function sendRTCSignal(toUserId: string, signal: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; kind?: 'bc' | 'vw' }): void {
  if (!wsClient) { console.error('sendRTCSignal: wsClient is null'); return }
  wsClient.send(WsMessageType.RTCSignal, { toUserId, sdp: signal.sdp, candidate: signal.candidate, kind: signal.kind })
}

export function sendRequestLivePreview(broadcasterUserId: string): void {
  if (!wsClient) { console.error('sendRequestLivePreview: wsClient is null'); return }
  wsClient.send(WsMessageType.RequestLivePreview, { broadcasterUserId })
}

liveRtc.initRtc(sendRTCSignal)

export function disconnectFromServer(): void {
  cleanupVoice()
  intentionalDisconnect = true
  reconnecting = false
  hasReceivedWelcome = false
  // Para o bot da rádio também (o áudio é independente da conexão WS).
  radioPlayer.stop()
  useAdminStore.getState().clear()
  wsClient?.disconnect()
  wsClient = null
  useConnectionStore.getState().setDisconnected()
  useRoomStore.getState().setCurrentRoom(null)
  useRoomStore.getState().clearMessages()
  useRoomStore.getState().setRooms([])
  useRoomStore.getState().setUsers([])
  useRoomStore.getState().setAccounts([])
  useLiveStore.getState().clearBroadcasters()
  useLiveStore.getState().clearChunks()
  useLiveStore.getState().setMyMime(null)
  liveRtc.cleanup()
  useVoiceStore.getState().clearSpeaking()
  useVoiceStore.getState().setRxLevel(0)
  for (const t of typingTimers.values()) clearTimeout(t)
  typingTimers.clear()
  useRoomStore.getState().clearTyping()
  useRoomStore.getState().clearUnread()
  useRoomStore.getState().setLoadingRooms(false)
  useRoomStore.getState().setLoadingMessages(false)
}

export function requestRoomList(): void {
  useRoomStore.getState().setLoadingRooms(true)
  wsClient?.send(WsMessageType.ListRooms)
}

export function requestUserList(): void {
  wsClient?.send(WsMessageType.ListUsers)
}

export function requestAccounts(): void {
  wsClient?.send(WsMessageType.ListAccounts)
}

export function sendAdminUpdateAccount(payload: { userId?: string; userName?: string; name?: string; email?: string; password?: string; isAdmin?: boolean; tags?: string[] }): void {
  if (!wsClient) { console.error('sendAdminUpdateAccount: wsClient is null'); return }
  wsClient.send(WsMessageType.AdminUpdateAccount, payload)
}

export function sendLiveStart(): void {
  wsClient?.send(WsMessageType.LiveStart)
}

export function sendLiveStop(): void {
  wsClient?.send(WsMessageType.LiveStop)
}

export function sendLiveChunk(chunk: string, duration: number): void {
  wsClient?.send(WsMessageType.LiveChunk, { chunk, duration })
}

export function sendLiveRequestCancel(): void {
  wsClient?.send(WsMessageType.LiveRequestCancel)
}

export function sendAdminCmd(cmd: string, payload: Record<string, unknown> = {}): void {
  if (!wsClient) { console.error('sendAdminCmd: wsClient is null'); return }
  wsClient.send(WsMessageType.AdminCmd, { cmd, ...payload })
}

export function completeOnboarding(): void {
  wsClient?.send(WsMessageType.OnboardingComplete, { deviceId: getDeviceId() })
}

export function sendLiveRequestResponse(allow: boolean, requesterId: string): void {
  wsClient?.send(WsMessageType.LiveRequestResponse, { allow, requesterId })
}
