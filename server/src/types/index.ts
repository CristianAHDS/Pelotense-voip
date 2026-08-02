import type { WebSocket as WsWebSocket } from 'ws'

export interface Client {
  id: string
  name: string
  password: string
  room: string | null
  udpPort: number
  ip: string
  lastPing: number
  admin: boolean
  avatar?: string
  email?: string
  tags?: string[]
  // Convidado (modo guest): sem conta, sem texto/privado — só áudio/vídeo/live.
  isGuest?: boolean
  // Restrições aplicadas pelo admin (runtime): mic/chat silenciados.
  restrictions?: { mic?: boolean; chat?: boolean }
  ws: WsWebSocket
}

export interface ChatMessage {
  id?: string
  userId: string
  userName: string
  text?: string
  audioData?: string
  videoData?: string
  imageData?: string
  duration?: number
  mime?: string
  timestamp: number
  forwarded?: boolean
  reactions?: MessageReaction[]
}

export interface MessageReaction {
  emoji: string
  userIds: string[]
}

export interface PrivateMessage {
  id?: string
  fromUserId: string
  fromUserName: string
  toUserId: string
  text?: string
  audioData?: string
  videoData?: string
  duration?: number
  mime?: string
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
  createdBy?: string
  createdByName?: string
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
  ListAccounts = 'list_accounts',
  AccountsList = 'accounts_list',
  AdminUpdateAccount = 'admin_update_account',
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
  ChatImageMessage = 'chat_image_message',
  ChatMessage = 'chat_message',
  MessageReaction = 'message_reaction',
  ForwardMessage = 'forward_message',
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
  LiveForceStop = 'live_force_stop',
  RTCSignal = 'rtc_signal',
  LivePeerJoined = 'live_peer_joined',
  RequestLivePreview = 'request_live_preview',
  PrivateAudioMessage = 'private_audio_message',
  PrivateVideoMessage = 'private_video_message',
  PrivateImageMessage = 'private_image_message',
  DeletePrivateMessage = 'delete_private_message',
  PrivateMessageDeleted = 'private_message_deleted',
  ListPrivateMessages = 'list_private_messages',
  PrivateHistory = 'private_history',
  UpdateProfile = 'update_profile',
  ProfileUpdated = 'profile_updated',
  // Canal genérico de comandos do admin (dashboard/sistema).
  AdminCmd = 'admin_cmd',
  AdminResult = 'admin_result',
  AdminLog = 'admin_log',
  RadioControl = 'radio_control',
  GlobalAnnouncement = 'global_announcement',
  MaintenanceState = 'maintenance_state',
  GuestState = 'guest_state',
  OnboardingComplete = 'onboarding_complete',
  SettingsState = 'settings_state',
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
  mime?: string
}

export type EventListener<T = unknown> = (payload: T) => void

export interface SecurityLimits {
  maxNameLength: number
  maxPasswordLength: number
  maxRoomNameLength: number
  maxTextLength: number
  maxAudioMessageBytes: number
  maxVideoMessageBytes: number
  maxImageMessageBytes: number
  maxLiveChunkBytes: number
  maxVoiceFrameBytes: number
  maxAvatarBytes: number
}

export const DEFAULT_SECURITY_LIMITS: SecurityLimits = {
  maxNameLength: 32,
  maxPasswordLength: 128,
  maxRoomNameLength: 64,
  maxTextLength: 4000,
  maxAudioMessageBytes: 512 * 1024,
  maxVideoMessageBytes: 5 * 1024 * 1024,
  maxImageMessageBytes: 5 * 1024 * 1024,
  maxLiveChunkBytes: 2 * 1024 * 1024,
  maxVoiceFrameBytes: 64 * 1024,
  maxAvatarBytes: 2 * 1024 * 1024,
}
