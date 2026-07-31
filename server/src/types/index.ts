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
  id?: string
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
  DeleteMessage = 'delete_message',
  MessageDeleted = 'message_deleted',
  Welcome = 'welcome',
  LiveStart = 'live_start',
  LiveStop = 'live_stop',
  LiveChunk = 'live_chunk',
  LiveStarted = 'live_started',
  LiveStopped = 'live_stopped',
  LiveRequest = 'live_request',
  LiveRequestResponse = 'live_request_response',
  LiveRequestCancel = 'live_request_cancel',
  LiveRequestCancelled = 'live_request_cancelled',
  LiveChunkReceived = 'live_chunk_received',
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

export interface LiveState {
  userId: string
  userName: string
  timestamp: number
  takeoverRequesterId?: string
  initChunk?: string
}

export type EventListener<T = unknown> = (payload: T) => void

export interface SecurityLimits {
  maxNameLength: number
  maxPasswordLength: number
  maxRoomNameLength: number
  maxTextLength: number
  maxAudioMessageBytes: number
  maxVideoMessageBytes: number
  maxLiveChunkBytes: number
  maxVoiceFrameBytes: number
}

export const DEFAULT_SECURITY_LIMITS: SecurityLimits = {
  maxNameLength: 32,
  maxPasswordLength: 128,
  maxRoomNameLength: 64,
  maxTextLength: 4000,
  maxAudioMessageBytes: 512 * 1024,
  maxVideoMessageBytes: 2 * 1024 * 1024,
  maxLiveChunkBytes: 512 * 1024,
  maxVoiceFrameBytes: 64 * 1024,
}
