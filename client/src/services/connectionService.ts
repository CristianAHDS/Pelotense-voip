import { WsClient } from '../network/wsClient.ts'
import { WsMessageType, LoginPayload, WelcomePayload, ChatMsg, PrivateChatMsg } from '../types/index.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useAccountStore } from '../stores/accountStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { VoiceManager } from '../voice/index.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { useToastStore } from '../stores/toastStore.ts'
import { notifyNewMessage, requestNotificationPermission } from './notifications.ts'
import { chatHistory } from './historyStore.ts'
import * as liveRtc from './liveRtc.ts'

let wsClient: WsClient | null = null
let reconnecting: boolean = false
let intentionalDisconnect: boolean = false
let voiceManager: VoiceManager | null = null
let voiceCleanup: (() => void) | null = null

export function getWsClient(): WsClient | null {
  return wsClient
}

export function getVoiceManager(): VoiceManager | null {
  return voiceManager
}

export function sendVoiceData(data: ArrayBuffer): void {
  wsClient?.sendBinary(data)
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
  if (payload.audioData) return '🎤 Mensagem de voz'
  if (payload.videoData) return '🎬 Mensagem de vídeo'
  if (payload.imageData) return '🖼️ Imagem'
  return 'Nova mensagem'
}

function onRoomChatMessage(payload: ChatMsg): void {
  useRoomStore.getState().addMessage(payload)
  const roomId = useRoomStore.getState().currentRoom
  if (roomId) {
    void chatHistory.saveRoomMessages(roomId, useRoomStore.getState().messages)
  }
  markRoomUnread()
  if (typeof document !== 'undefined' && document.hidden) {
    notifyNewMessage(
      `#${useRoomStore.getState().currentRoomName ?? 'sala'}`,
      `${payload.userName}: ${messageBody(payload)}`
    )
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

export function connectToServer(address: string, name: string, password: string, email?: string, intent?: 'login' | 'register'): void {
  if (wsClient) disconnectFromServer()

  useConnectionStore.getState().setLoginStep('none')

  wsClient = new WsClient()
  reconnecting = false
  initVoice()

  wsClient.on('connected', () => {
    const avatar = useAccountStore.getState().avatar
    const payload: LoginPayload = { name, password, email: email || undefined, avatar: avatar || undefined, intent }
    wsClient?.send(WsMessageType.Login, payload)
  })
  wsClient.on('disconnected', () => {
    if (intentionalDisconnect) {
      intentionalDisconnect = false
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
    const payload = msg.payload as WelcomePayload
    useConnectionStore.getState().setConnected(payload.id, payload.name, !!payload.admin)
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
    const payload = msg.payload as { fromUserId: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
    liveRtc.handleSignal(payload.fromUserId, { sdp: payload.sdp, candidate: payload.candidate })
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
    const serverMsgs: ChatMsg[] = payload.messages ?? []
    useRoomStore.getState().setMessages(serverMsgs)
    useRoomStore.getState().markRoomRead(payload.roomId)
    useRoomStore.getState().setLoadingMessages(false)
    voiceOnRoomJoined()
    if (payload.roomId) {
      if (serverMsgs.length > 0) {
        void chatHistory.saveRoomMessages(payload.roomId, serverMsgs)
      } else {
        const local = await chatHistory.loadRoomMessages(payload.roomId)
        if (local && local.length > 0) {
          useRoomStore.getState().setMessages(local)
        }
      }
    }
  })

  wsClient.on(WsMessageType.RoomLeft, () => {
    useRoomStore.getState().setCurrentRoom(null)
    useRoomStore.getState().clearMessages()
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
    const payload = msg.payload as { userId: string; userName: string; mime?: string }
    useLiveStore.getState().setBroadcaster({ userId: payload.userId, userName: payload.userName })
    useLiveStore.getState().setMime(payload.mime ?? null)
  })

  wsClient.on(WsMessageType.LiveStopped, (msg) => {
    useLiveStore.getState().setBroadcaster(null)
    useLiveStore.getState().setMime(null)
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
    persistDm(dmKey(payload))
    maybeNotifyPrivate(payload, payload.text ?? 'Nova mensagem')
  })

  wsClient.on(WsMessageType.PrivateAudioMessage, (msg) => {
    const payload = msg.payload as PrivateChatMsg
    usePrivateChatStore.getState().addMessage(payload)
    persistDm(dmKey(payload))
    maybeNotifyPrivate(payload, '🎤 Mensagem de voz')
  })

  wsClient.on(WsMessageType.PrivateVideoMessage, (msg) => {
    const payload = msg.payload as PrivateChatMsg
    usePrivateChatStore.getState().addMessage(payload)
    persistDm(dmKey(payload))
    maybeNotifyPrivate(payload, '🎬 Mensagem de vídeo')
  })

  wsClient.on(WsMessageType.PrivateImageMessage, (msg) => {
    const payload = msg.payload as PrivateChatMsg
    usePrivateChatStore.getState().addMessage(payload)
    persistDm(dmKey(payload))
    maybeNotifyPrivate(payload, '🖼️ Imagem')
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
    const error = String(msg.payload ?? 'Unknown error')
    useConnectionStore.getState().setDisconnected()
    useToastStore.getState().show('error', `Connection error: ${error}`)
  })

  wsClient.connect(address)
}

export function joinRoom(roomName: string): void {
  if (!wsClient) { console.error('joinRoom: wsClient is null'); return }
  voiceManager?.resumeOutput()
  useRoomStore.getState().setLoadingMessages(true)
  wsClient.send(WsMessageType.JoinRoom, roomName)
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

export function sendChatMessage(text: string): void {
  if (!wsClient) { console.error('sendChatMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.ChatMessage, { text })
}

export function generateClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
}

export function sendChatAudioMessage(id: string, audioData: string, duration: number): void {
  if (!wsClient) { console.error('sendChatAudioMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.ChatAudioMessage, { id, audioData, duration })
}

export function sendChatVideoMessage(id: string, videoData: string, duration: number): void {
  if (!wsClient) { console.error('sendChatVideoMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.ChatVideoMessage, { id, videoData, duration })
}

export function sendChatImageMessage(id: string, imageData: string): void {
  if (!wsClient) { console.error('sendChatImageMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.ChatImageMessage, { id, imageData })
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
  wsClient.send(WsMessageType.PrivateMessage, { toUserId, text, id })
}

export function sendPrivateAudioMessage(toUserId: string, id: string, audioData: string, duration: number): void {
  if (!wsClient) { console.error('sendPrivateAudioMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.PrivateAudioMessage, { toUserId, id, audioData, duration })
}

export function sendPrivateVideoMessage(toUserId: string, id: string, videoData: string, duration: number): void {
  if (!wsClient) { console.error('sendPrivateVideoMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.PrivateVideoMessage, { toUserId, id, videoData, duration })
}

export function sendPrivateImageMessage(toUserId: string, id: string, imageData: string): void {
  if (!wsClient) { console.error('sendPrivateImageMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.PrivateImageMessage, { toUserId, id, imageData })
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

export function sendRTCSignal(toUserId: string, signal: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }): void {
  if (!wsClient) { console.error('sendRTCSignal: wsClient is null'); return }
  wsClient.send(WsMessageType.RTCSignal, { toUserId, sdp: signal.sdp, candidate: signal.candidate })
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
  wsClient?.disconnect()
  wsClient = null
  useConnectionStore.getState().setDisconnected()
  useRoomStore.getState().setCurrentRoom(null)
  useRoomStore.getState().clearMessages()
  useRoomStore.getState().setRooms([])
  useRoomStore.getState().setUsers([])
  useRoomStore.getState().setAccounts([])
  useLiveStore.getState().setBroadcaster(null)
  useLiveStore.getState().clearChunks()
  useLiveStore.getState().setMime(null)
  useLiveStore.getState().setMyMime(null)
  liveRtc.cleanup()
  useVoiceStore.getState().clearSpeaking()
  useVoiceStore.getState().setRxLevel(0)
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

export function sendLiveRequestResponse(allow: boolean, requesterId: string): void {
  wsClient?.send(WsMessageType.LiveRequestResponse, { allow, requesterId })
}
