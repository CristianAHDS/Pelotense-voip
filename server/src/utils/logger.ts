import { LogLevel } from '../types/index.js'
import { config } from '../config/index.js'

const levelOrder: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
}

function shouldLog(level: LogLevel): boolean {
  return levelOrder[level] >= levelOrder[config.logLevel]
}

function timestamp(): string {
  return new Date().toISOString()
}

export const logger = {
  debug(context: string, message: string, data?: unknown): void {
    if (!shouldLog(LogLevel.DEBUG)) return
    const meta = data ? ` ${JSON.stringify(data)}` : ''
    console.log(`[${timestamp()}] [DEBUG] [${context}] ${message}${meta}`)
  },

  info(context: string, message: string, data?: unknown): void {
    if (!shouldLog(LogLevel.INFO)) return
    const meta = data ? ` ${JSON.stringify(data)}` : ''
    console.log(`[${timestamp()}] [INFO] [${context}] ${message}${meta}`)
  },

  warn(context: string, message: string, data?: unknown): void {
    if (!shouldLog(LogLevel.WARN)) return
    const meta = data ? ` ${JSON.stringify(data)}` : ''
    console.warn(`[${timestamp()}] [WARN] [${context}] ${message}${meta}`)
  },

  error(context: string, message: string, data?: unknown): void {
    if (!shouldLog(LogLevel.ERROR)) return
    const meta = data ? ` ${JSON.stringify(data)}` : ''
    console.error(`[${timestamp()}] [ERROR] [${context}] ${message}${meta}`)
  },
}
