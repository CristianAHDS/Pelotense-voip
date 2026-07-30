import type { WebSocket as WsWebSocket } from 'ws'

export interface Client {
  id: string
  name: string
  password: string
  room: string | null
  udpPort: number
  ip: string
  lastPing: number
  ws: WsWebSocket
}

export interface ChatMessage {
  userId: string
  userName: string
  text?: string
  audioData?: string
  videoData?: string
  duration?: number
  timestamp: number
}

export interface Room {
  id: string
  name: string
  clients: Map<string, Client>
  createdAt: number
  messages: ChatMessage[]
  fixed: boolean
  featured?: number
}

export enum PacketType {
  VoiceData = 0,
  Ping = 1,
  Pong = 2,
}

export interface VoicePacket {
  version: number
  packetType: PacketType
  userId: string
  roomId: string
  sequence: number
  timestamp: number
  payload: Buffer
}

export enum WsMessageType {
  JoinRoom = 'join_room',
  LeaveRoom = 'leave_room',
  CreateRoom = 'create_room',
  DeleteRoom = 'delete_room',
  ListRooms = 'list_rooms',
  ListUsers = 'list_users',
  Heartbeat = 'heartbeat',
  RoomJoined = 'room_joined',
  RoomLeft = 'room_left',
  RoomCreated = 'room_created',
  RoomDeleted = 'room_deleted',
  RoomList = 'room_list',
  UserList = 'user_list',
  UserJoined = 'user_joined',
  UserLeft = 'user_left',
  Error = 'error',
  Login = 'login',
  ChatAudioMessage = 'chat_audio_message',
  ChatVideoMessage = 'chat_video_message',
  ChatMessage = 'chat_message',
  PrivateMessage = 'private_message',
  Welcome = 'welcome',
}

export interface WsMessage {
  type: WsMessageType
  payload?: unknown
}

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface ServerConfig {
  serverPort: number
  wsPort: number
  udpPort: number
  maxUsers: number
  maxRooms: number
  logLevel: LogLevel
}

export enum EventType {
  ClientConnected = 'client:connected',
  ClientDisconnected = 'client:disconnected',
  RoomCreated = 'room:created',
  RoomDeleted = 'room:deleted',
  RoomJoined = 'room:joined',
  RoomLeft = 'room:left',
  VoicePacketReceived = 'voice:packet_received',
  VoicePacketSent = 'voice:packet_sent',
}

export type EventPayloads = {
  [EventType.ClientConnected]: { clientId: string; name: string }
  [EventType.ClientDisconnected]: { clientId: string; name: string }
  [EventType.RoomCreated]: { roomId: string; roomName: string }
  [EventType.RoomDeleted]: { roomId: string; roomName: string }
  [EventType.RoomJoined]: { clientId: string; roomId: string }
  [EventType.RoomLeft]: { clientId: string; roomId: string }
  [EventType.VoicePacketReceived]: { userId: string; roomId: string; size: number }
  [EventType.VoicePacketSent]: { userId: string; roomId: string; targets: number }
}

export type EventListener<T = unknown> = (payload: T) => void
