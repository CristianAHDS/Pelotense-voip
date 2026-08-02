export interface RoomInfo {
  id: string
  name: string
  users: number
  fixed?: boolean
  featured?: number
  createdBy?: string
  createdByName?: string
  live?: { userId: string; userName: string } | null
}

export interface UserInfo {
  id: string
  name: string
  room: string | null
  admin?: boolean
  avatar?: string
  tags?: string[]
}

export interface AccountInfo {
  id?: string
  name: string
  email?: string
  avatar?: string
  admin?: boolean
  online?: boolean
  tags?: string[]
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
  ChatMessage = 'chat_message',
  ChatAudioMessage = 'chat_audio_message',
  ChatVideoMessage = 'chat_video_message',
  ChatImageMessage = 'chat_image_message',
  MessageReaction = 'message_reaction',
  ForwardMessage = 'forward_message',
  PrivateMessage = 'private_message',
  DeleteMessage = 'delete_message',
  MessageDeleted = 'message_deleted',
  Login = 'login',
  Error = 'error',
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
  AdminCmd = 'admin_cmd',
  AdminResult = 'admin_result',
  AdminLog = 'admin_log',
  RadioControl = 'radio_control',
  GlobalAnnouncement = 'global_announcement',
  MaintenanceState = 'maintenance_state',
  GuestState = 'guest_state',
  OnboardingComplete = 'onboarding_complete',
}

export interface AdminMetrics {
  usersOnline: number
  maxUsers: number
  rooms: number
  maxRooms: number
  liveCount: number
  accounts: number
  devices: number
  messages: number
  privateMessages: number
  messagesToday: number
  privateToday: number
  uptimeSeconds: number
  memoryMB: number
  heapMB: number
  maintenance: boolean
}

export interface AdminRoomInfo {
  id: string
  name: string
  fixed: boolean
  featured?: number
  users: number
  messages: number
  occupants: string[]
  live?: { userId: string; userName: string } | null
  createdByName?: string
}

export interface AdminBan {
  name?: string
  email?: string
  reason?: string
  date: number
}

export interface AdminLogEntry {
  at: number
  by: string
  action: string
  detail?: string
}

export interface AdminDiagnostics {
  uptimeSeconds: number
  memoryMB: number
  heapMB: number
  clients: number
  rooms: number
  liveCount: number
  pendingConnections: number
  maintenance: boolean
}

export interface AdminResult {
  cmd: string
  ok: boolean
  data?: unknown
  error?: string
}

export interface WsMessage {
  type: WsMessageType
  payload?: unknown
}

export interface LoginPayload {
  name: string
  email?: string
  password: string
  avatar?: string
  intent?: 'login' | 'register'
  deviceId?: string
}

export interface WelcomePayload {
  id: string
  name: string
  udpPort: number
  admin?: boolean
  avatar?: string
  email?: string
  tags?: string[]
  maintenance?: boolean
  maintenanceMessage?: string
  onboarding?: boolean
}

export interface ChatMsg {
  id?: string
  userId: string
  userName: string
  text?: string
  audioData?: string
  videoData?: string
  imageData?: string
  duration?: number
  timestamp: number
  forwarded?: boolean
  reactions?: MessageReaction[]
  // apenas no cliente: marca mensagem otimista ainda não confirmada pelo servidor
  sending?: boolean
  // apenas no cliente: envio falhou (timeout) e pode ser reenviado
  failed?: boolean
}

export interface MessageReaction {
  emoji: string
  userIds: string[]
}

export interface DeleteMessagePayload {
  messageId: string
}

export interface PrivateChatMsg {
  id?: string
  fromUserId: string
  fromUserName: string
  toUserId?: string
  text?: string
  audioData?: string
  videoData?: string
  imageData?: string
  duration?: number
  timestamp: number
  // apenas no cliente: marca mensagem otimista ainda não confirmada pelo servidor
  sending?: boolean
  // apenas no cliente: envio falhou (timeout) e pode ser reenviado
  failed?: boolean
}

export interface RoomJoinedPayload {
  roomId: string
  roomName: string
  messages: ChatMsg[]
}

export interface ConnectionStatus {
  connected: boolean
  id: string | null
  name: string | null
  serverAddress: string
}

export interface VoiceState {
  muted: boolean
  volume: number
  level: number
  rxLevel: number
  speaking: Record<string, number>
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
  payload: ArrayBuffer
}
