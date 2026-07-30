import { WsClient } from '../network/wsClient.ts'
import { WsMessageType, LoginPayload, WelcomePayload, ChatMsg } from '../types/index.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'

let wsClient: WsClient | null = null
let reconnecting: boolean = false

export function getWsClient(): WsClient | null {
  return wsClient
}

export function connectToServer(address: string, name: string, password: string): void {
  if (wsClient) disconnectFromServer()

  wsClient = new WsClient()
  reconnecting = false

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
    useRoomStore.getState().clearMessages()
  })

  wsClient.on(WsMessageType.RoomLeft, () => {
    useRoomStore.getState().setCurrentRoom(null)
    useRoomStore.getState().clearMessages()
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

  wsClient.on(WsMessageType.Error, (msg) => {
    const error = String(msg.payload ?? 'Unknown error')
    useConnectionStore.getState().setDisconnected()
    alert(`Connection error: ${error}`)
  })

  wsClient.connect(address)
}

export function sendChatMessage(text: string): void {
  wsClient?.send(WsMessageType.ChatMessage, { text })
}

export function disconnectFromServer(): void {
  reconnecting = false
  wsClient?.disconnect()
  wsClient = null
  useConnectionStore.getState().setDisconnected()
}

export function joinRoom(roomName: string): void {
  wsClient?.send(WsMessageType.JoinRoom, roomName)
}

export function leaveRoom(): void {
  wsClient?.send(WsMessageType.LeaveRoom)
}

export function createRoom(roomName: string): void {
  wsClient?.send(WsMessageType.CreateRoom, roomName)
}

export function requestRoomList(): void {
  wsClient?.send(WsMessageType.ListRooms)
}

export function requestUserList(): void {
  wsClient?.send(WsMessageType.ListUsers)
}
