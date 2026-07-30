export interface RoomInfo {
  id: string
  name: string
  users: number
  fixed?: boolean
  featured?: number
}

export interface UserInfo {
  id: string
  name: string
  room: string | null
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
  ChatMessage = 'chat_message',
  ChatAudioMessage = 'chat_audio_message',
  ChatVideoMessage = 'chat_video_message',
  PrivateMessage = 'private_message',
  Login = 'login',
  Error = 'error',
  Welcome = 'welcome',
}

export interface WsMessage {
  type: WsMessageType
  payload?: unknown
}

export interface LoginPayload {
  name: string
  password: string
}

export interface WelcomePayload {
  id: string
  name: string
  udpPort: number
}

export interface ChatMsg {
  userId: string
  userName: string
  text?: string
  audioData?: string
  videoData?: string
  duration?: number
  timestamp: number
}

export interface PrivateChatMsg {
  fromUserId: string
  fromUserName: string
  toUserId?: string
  text: string
  timestamp: number
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
