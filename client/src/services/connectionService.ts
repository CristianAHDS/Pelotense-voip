import { WsClient } from '../network/wsClient.ts'
import { WsMessageType, LoginPayload, WelcomePayload, ChatMsg, PrivateChatMsg } from '../types/index.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { VoiceManager } from '../voice/index.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'

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
    voiceManager?.playAudio(audioData)
  }) ?? null
}

function cleanupVoice(): void {
  voiceManager?.stopMicrophone()
  voiceCleanup?.()
  voiceCleanup = null
  voiceManager?.destroy()
  voiceManager = null
}

function voiceOnRoomJoined(): void {
  const muted = useVoiceStore.getState().muted
  if (!muted) {
    voiceManager?.startMicrophone().then((ok) => {
      if (!ok) useVoiceStore.getState().setMuted(true)
    })
  }
}

function voiceOnRoomLeft(): void {
  voiceManager?.stopMicrophone()
}

export function connectToServer(address: string, name: string, password: string): void {
  if (wsClient) disconnectFromServer()

  wsClient = new WsClient()
  reconnecting = false
  initVoice()

  wsClient.on('connected', () => {
    const payload: LoginPayload = { name, password }
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
    useConnectionStore.getState().setConnected(payload.id, payload.name)
    requestRoomList()
  })

  wsClient.on(WsMessageType.RoomList, (msg) => {
    useRoomStore.getState().setRooms(msg.payload as any)
  })

  wsClient.on(WsMessageType.UserList, (msg) => {
    useRoomStore.getState().setUsers(msg.payload as any)
  })

  wsClient.on(WsMessageType.RoomJoined, (msg) => {
    const payload = msg.payload as any
    useRoomStore.getState().setCurrentRoom(payload.roomId, payload.roomName)
    useRoomStore.getState().setMessages(payload.messages ?? [])
    voiceOnRoomJoined()
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
    useRoomStore.getState().addMessage(msg.payload as ChatMsg)
  })

  wsClient.on(WsMessageType.ChatAudioMessage, (msg) => {
    useRoomStore.getState().addMessage(msg.payload as ChatMsg)
  })

  wsClient.on(WsMessageType.ChatVideoMessage, (msg) => {
    useRoomStore.getState().addMessage(msg.payload as ChatMsg)
  })

  wsClient.on(WsMessageType.MessageDeleted, (msg) => {
    const payload = msg.payload as { messageId: string }
    useRoomStore.getState().removeMessage(payload.messageId)
  })

  wsClient.on(WsMessageType.LiveStarted, (msg) => {
    const payload = msg.payload as { userId: string; userName: string }
    useLiveStore.getState().setBroadcaster({ userId: payload.userId, userName: payload.userName })
  })

  wsClient.on(WsMessageType.LiveStopped, (msg) => {
    useLiveStore.getState().setBroadcaster(null)
  })

  wsClient.on(WsMessageType.LiveChunkReceived, (msg) => {
    const payload = msg.payload as { userId: string; chunk: string; duration: number }
    useLiveStore.getState().addChunk({ userId: payload.userId, chunk: payload.chunk, duration: payload.duration })
  })

  wsClient.on(WsMessageType.LiveRequest, (msg) => {
    const payload = msg.payload as { fromUserId: string; fromUserName: string }
    useLiveStore.getState().setPendingRequest(payload)
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

  wsClient.on(WsMessageType.PrivateMessage, (msg) => {
    const payload = msg.payload as PrivateChatMsg
    usePrivateChatStore.getState().addMessage(payload)
  })

  wsClient.on(WsMessageType.Error, (msg) => {
    const error = String(msg.payload ?? 'Unknown error')
    useConnectionStore.getState().setDisconnected()
    alert(`Connection error: ${error}`)
  })

  wsClient.connect(address)
}

export function joinRoom(roomName: string): void {
  if (!wsClient) { console.error('joinRoom: wsClient is null'); return }
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

export function sendChatAudioMessage(audioData: string, duration: number): void {
  if (!wsClient) { console.error('sendChatAudioMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.ChatAudioMessage, { audioData, duration })
}

export function sendChatVideoMessage(videoData: string, duration: number): void {
  if (!wsClient) { console.error('sendChatVideoMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.ChatVideoMessage, { videoData, duration })
}

export function deleteMessage(messageId: string): void {
  if (!wsClient) { console.error('deleteMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.DeleteMessage, { messageId })
}

export function sendPrivateMessage(toUserId: string, text: string): void {
  if (!wsClient) { console.error('sendPrivateMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.PrivateMessage, { toUserId, text })
}

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
  useLiveStore.getState().setBroadcaster(null)
  useLiveStore.getState().clearChunks()
}

export function requestRoomList(): void {
  wsClient?.send(WsMessageType.ListRooms)
}

export function requestUserList(): void {
  wsClient?.send(WsMessageType.ListUsers)
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

export function sendLiveRequestResponse(allow: boolean, requesterId: string): void {
  wsClient?.send(WsMessageType.LiveRequestResponse, { allow, requesterId })
}
