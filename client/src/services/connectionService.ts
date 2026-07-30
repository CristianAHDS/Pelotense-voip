import { WsClient } from '../network/wsClient.ts'
import { WsMessageType, LoginPayload, WelcomePayload, ChatMsg, PrivateChatMsg } from '../types/index.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { VoiceManager } from '../voice/index.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

let wsClient: WsClient | null = null
let reconnecting: boolean = false
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
    voiceManager?.startMicrophone().catch(() => {})
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
    if (wsClient) {
      reconnecting = true
      useConnectionStore.getState().setReconnecting(true)
    } else {
      useConnectionStore.getState().setDisconnected()
      useRoomStore.getState().setCurrentRoom(null)
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

export function sendPrivateMessage(toUserId: string, text: string): void {
  if (!wsClient) { console.error('sendPrivateMessage: wsClient is null'); return }
  wsClient.send(WsMessageType.PrivateMessage, { toUserId, text })
}

export function disconnectFromServer(): void {
  cleanupVoice()
  reconnecting = false
  wsClient?.disconnect()
  wsClient = null
  useConnectionStore.getState().setDisconnected()
}

export function requestRoomList(): void {
  wsClient?.send(WsMessageType.ListRooms)
}

export function requestUserList(): void {
  wsClient?.send(WsMessageType.ListUsers)
}
