import { WebSocketServer, WebSocket } from 'ws'
import type { AddressInfo } from 'net'
import { WsHandler } from '../network/wsHandler.js'
import { ClientManager } from '../clients/manager.js'
import { RoomManager } from '../rooms/manager.js'
import { WsMessage, WsMessageType, SecurityLimits } from '../types/index.js'
import { SqliteStore } from '../storage/index.js'

export interface TestServer {
  wss: WebSocketServer
  clients: ClientManager
  rooms: RoomManager
  handler: WsHandler
  port: number
  close: () => Promise<void>
}

export async function startTestServer(maxUsers = 100, maxRooms = 20, limits?: SecurityLimits, adminNames: string[] = [], storage?: SqliteStore, adminIds: string[] = []): Promise<TestServer> {
  const wss = new WebSocketServer({ port: 0 })
  const clients = new ClientManager(maxUsers)
  const rooms = new RoomManager(maxRooms, storage)
  const handler = new WsHandler(wss, clients, rooms, 3002, limits, adminNames, storage, adminIds)
  const port = (wss.address() as AddressInfo).port
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      for (const c of clients.getAll()) {
        try {
          c.ws.terminate()
        } catch { /* ignore */ }
      }
      wss.close(() => resolve())
    })
  return { wss, clients, rooms, handler, port, close }
}

export class TestClient {
  ws: WebSocket
  private queue: WsMessage[] = []
  private waiters: Array<{ type: string; resolve: (m: WsMessage) => void }> = []
  private binaries: Buffer[] = []
  private binaryWaiters: Array<(b: Buffer) => void> = []

  constructor(ws: WebSocket) {
    this.ws = ws
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const b = data as Buffer
        const w = this.binaryWaiters.shift()
        if (w) w(b)
        else this.binaries.push(b)
        return
      }
      const msg = JSON.parse(data.toString()) as WsMessage
      const idx = this.waiters.findIndex((w) => w.type === msg.type)
      if (idx !== -1) {
        const [w] = this.waiters.splice(idx, 1)
        w.resolve(msg)
      } else {
        this.queue.push(msg)
      }
    })
  }

  get id(): string | undefined {
    return (this.ws as unknown as { _clientId?: string })._clientId
  }

  send(type: string, payload?: unknown): void {
    this.ws.send(JSON.stringify({ type, payload }))
  }

  async waitFor(type: string, timeout = 5000): Promise<WsMessage> {
    const idx = this.queue.findIndex((m) => m.type === type)
    if (idx !== -1) return this.queue.splice(idx, 1)[0]
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      const waiter = {
        type,
        resolve: (m: WsMessage) => {
          clearTimeout(timer)
          resolve(m)
        },
      }
      timer = setTimeout(() => {
        const wIdx = this.waiters.indexOf(waiter)
        if (wIdx !== -1) this.waiters.splice(wIdx, 1)
        reject(new Error(`Timeout waiting for ${type}`))
      }, timeout)
      this.waiters.push(waiter)
    })
  }

  async waitForClose(timeout = 5000): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for close')), timeout)
      this.ws.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  async waitForBinary(timeout = 5000): Promise<Buffer> {
    if (this.binaries.length > 0) return this.binaries.shift()!
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for binary')), timeout)
      this.binaryWaiters.push((b) => {
        clearTimeout(timer)
        resolve(b)
      })
    })
  }

  hasQueued(type: string): boolean {
    return this.queue.some((m) => m.type === type)
  }
}

export async function connectClient(port: number, name: string, password: string, avatar?: string, email?: string): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', (err) => reject(err))
  })
  const client = new TestClient(ws)
  const loginPayload: { name: string; password: string; avatar?: string; email?: string } = { name, password }
  if (avatar !== undefined) loginPayload.avatar = avatar
  if (email !== undefined) loginPayload.email = email
  client.send(WsMessageType.Login, loginPayload)
  const welcome = await client.waitFor(WsMessageType.Welcome)
  const payload = welcome.payload as { id: string }
  ;(ws as unknown as { _clientId: string })._clientId = payload.id
  return client
}
