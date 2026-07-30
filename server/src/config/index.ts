import dotenv from 'dotenv'
import { LogLevel } from '../types/index.js'

dotenv.config()

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

export const config = {
  serverHost: getEnv('HOST', '0.0.0.0'),
  serverPort: getInt('SERVER_PORT', 3000),
  wsPort: getInt('WS_PORT', 3001),
  udpPort: getInt('UDP_PORT', 3002),
  maxUsers: getInt('MAX_USERS', 100),
  maxRooms: getInt('MAX_ROOMS', 20),
  logLevel: getLogLevel('LOG_LEVEL', LogLevel.INFO),
}
