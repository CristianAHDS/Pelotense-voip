import dotenv from 'dotenv'
import { LogLevel, SecurityLimits, DEFAULT_SECURITY_LIMITS } from '../types/index.js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..', '..')

function readVersion(): { version: string; build: number } {
  try {
    const raw = JSON.parse(readFileSync(resolve(ROOT, 'version.json'), 'utf8'))
    return {
      version: typeof raw.version === 'string' ? raw.version : '1.0.0',
      build: Number.isFinite(raw.build) ? raw.build : 0,
    }
  } catch {
    return { version: '1.0.0', build: 0 }
  }
}

function getEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

function getInt(key: string, fallback: number): number {
  const val = parseInt(process.env[key] ?? '', 10)
  return isNaN(val) ? fallback : val
}

function getLogLevel(key: string, fallback: LogLevel): LogLevel {
  const val = process.env[key]?.toUpperCase() as LogLevel | undefined
  if (val && Object.values(LogLevel).includes(val)) return val
  return fallback
}

function getList(key: string, fallback: string[]): string[] {
  const val = process.env[key]
  if (!val) return fallback
  return val.split(',').map((s) => s.trim()).filter(Boolean)
}

export const config = {
  serverHost: getEnv('HOST', '0.0.0.0'),
  serverPort: getInt('SERVER_PORT', 3000),
  wsPort: getInt('WS_PORT', 3001),
  wssPort: getInt('WSS_PORT', 3003),
  httpsClientPort: getInt('HTTPS_CLIENT_PORT', 3443),
  maxUsers: getInt('MAX_USERS', 100),
  maxRooms: getInt('MAX_ROOMS', 20),
  maxWsPayload: getInt('MAX_WS_PAYLOAD', 2 * 1024 * 1024 * 1024),
  logLevel: getLogLevel('LOG_LEVEL', LogLevel.INFO),
  adminNames: getList('ADMIN_NAMES', []),
  adminIds: getList('ADMIN_IDS', []),
  dbPath: getEnv('DB_PATH', './data/voip.db'),
  appVersion: readVersion(),
}

export const securityLimits: SecurityLimits = {
  maxNameLength: getInt('MAX_NAME_LENGTH', DEFAULT_SECURITY_LIMITS.maxNameLength),
  maxPasswordLength: getInt('MAX_PASSWORD_LENGTH', DEFAULT_SECURITY_LIMITS.maxPasswordLength),
  maxRoomNameLength: getInt('MAX_ROOM_NAME_LENGTH', DEFAULT_SECURITY_LIMITS.maxRoomNameLength),
  maxTextLength: getInt('MAX_TEXT_LENGTH', DEFAULT_SECURITY_LIMITS.maxTextLength),
  maxAudioMessageBytes: getInt('MAX_AUDIO_MESSAGE_BYTES', DEFAULT_SECURITY_LIMITS.maxAudioMessageBytes),
  maxVideoMessageBytes: getInt('MAX_VIDEO_MESSAGE_BYTES', DEFAULT_SECURITY_LIMITS.maxVideoMessageBytes),
  maxImageMessageBytes: getInt('MAX_IMAGE_MESSAGE_BYTES', DEFAULT_SECURITY_LIMITS.maxImageMessageBytes),
  maxFileMessageBytes: getInt('MAX_FILE_MESSAGE_BYTES', DEFAULT_SECURITY_LIMITS.maxFileMessageBytes),
  maxLiveChunkBytes: getInt('MAX_LIVE_CHUNK_BYTES', DEFAULT_SECURITY_LIMITS.maxLiveChunkBytes),
  maxVoiceFrameBytes: getInt('MAX_VOICE_FRAME_BYTES', DEFAULT_SECURITY_LIMITS.maxVoiceFrameBytes),
  maxAvatarBytes: getInt('MAX_AVATAR_BYTES', DEFAULT_SECURITY_LIMITS.maxAvatarBytes),
}
